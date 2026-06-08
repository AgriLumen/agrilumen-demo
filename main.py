import math
import numpy as np
import pandas as pd
import json
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import ee
import sqlite3
from pydantic import BaseModel
from datetime import datetime

# --- Ініціалізація GEE із захистом ---
try:
    ee.Initialize(project='onyx-antler-495614-v2')
    print("🛰️ Підключення до Google Earth Engine УСПІШНЕ!")
except Exception as e:
    print(f"❌ Помилка підключення до Earth Engine: {e}")

app = FastAPI(title="AgriLumen Pro API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- РАБОТА С БАЗОЙ ДАННЫХ ---
DB_NAME = "agrilumen.db"

# =====================================================================
# --- ФУНКЦІЇ ОЧИЩЕННЯ ХМАР ДЛЯ РІЗНИХ СУПУТНИКІВ ---
# =====================================================================


def mask_s2_clouds(image):
    """Sentinel-2 (Європа)"""
    qa = image.select('QA60')
    cloudBitMask = 1 << 10
    cirrusBitMask = 1 << 11
    mask = qa.bitwiseAnd(cloudBitMask).eq(0).And(
        qa.bitwiseAnd(cirrusBitMask).eq(0))
    return image.updateMask(mask)


def mask_landsat_clouds(image):
    """Landsat 8/9 (США, NASA)"""
    qa = image.select('QA_PIXEL')
    mask = qa.bitwiseAnd(1 << 3).eq(0).And(qa.bitwiseAnd(1 << 4).eq(0))
    return image.updateMask(mask)


def mask_modis_clouds(image):
    """MODIS (Щоденний, грубий)"""
    state = image.select('state_1km')
    mask = state.bitwiseAnd(3).eq(0)
    return image.updateMask(mask)

# =====================================================================


def init_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS fields (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cadastre TEXT,
            name TEXT,
            crop TEXT,
            area REAL,
            lat REAL,
            lon REAL,
            variety TEXT,
            planting_date TEXT,
            prev_crop TEXT,
            geometry TEXT,
            soil_type TEXT
        )
    ''')
    # Захист для існуючої бази даних: додаємо стовбець, якщо таблиця вже була створена раніше
    try:
        cursor.execute("ALTER TABLE fields ADD COLUMN soil_type TEXT")
    except sqlite3.OperationalError:
        pass  # Стовбець вже існує, ігноруємо помилку
    conn.commit()
    conn.close()


init_db()


class FieldCreate(BaseModel):
    cadastre: str
    name: str
    crop: str
    area: float
    lat: float
    lon: float
    variety: str
    planting_date: str
    prev_crop: str
    geometry: str
    soil_type: str  # <-- Додали поле


@app.post("/api/fields")
def add_field(field: FieldCreate):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO fields (cadastre, name, crop, area, lat, lon, variety, planting_date, prev_crop, geometry, soil_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (field.cadastre, field.name, field.crop, field.area, field.lat, field.lon,
         field.variety, field.planting_date, field.prev_crop, field.geometry, field.soil_type)
    )
    conn.commit()
    field_id = cursor.lastrowid
    conn.close()
    return {"status": "saved", "field_id": field_id}


@app.get("/api/fields")
def get_fields():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM fields")
    fields = cursor.fetchall()
    conn.close()
    return fields


@app.get("/api/analyze/{field_id}")
def analyze_field(field_id: int, date_start: str, date_end: str):
    from datetime import datetime, timedelta
    import json
    import ee
    import sqlite3

    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT lat, lon, geometry FROM fields WHERE id = ?", (field_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return {"error": "Поле не знайдено"}
    lat, lon, geometry_str = row

    try:
        target_date = datetime.strptime(date_start, "%Y-%m-%d")
        ndvi_start = (target_date - timedelta(days=30)).strftime("%Y-%m-%d")
        gee_end = (target_date + timedelta(days=1)).strftime("%Y-%m-%d")

        if geometry_str and geometry_str != "null":
            coords = json.loads(geometry_str)
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            target_geometry = ee.Geometry.Polygon([coords])
        else:
            target_geometry = ee.Geometry.Point([lon, lat]).buffer(100)

        # === 1. МУЛЬТИСЕНСОРНА ВОЛОГА ТА ПОГОДА ===
        sar_collection = ee.ImageCollection("COPERNICUS/S1_GRD") \
            .filterBounds(target_geometry).filterDate(ndvi_start, gee_end) \
            .filter(ee.Filter.eq('instrumentMode', 'IW')) \
            .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))

        if sar_collection.size().getInfo() > 0:
            sar_image = sar_collection.sort('system:time_start', False).first()
            sar_stats = sar_image.reduceRegion(
                reducer=ee.Reducer.mean(), geometry=target_geometry, scale=10, maxPixels=1e9)
            vv_value = sar_stats.getInfo().get('VV')
            moisture_surface = round(
                (vv_value + 25) / 25 * 100, 1) if vv_value else 45.0
            moisture_surface = max(0, min(100, moisture_surface))
        else:
            moisture_surface = 45.0

        weather_collection = ee.ImageCollection("ECMWF/ERA5_LAND/DAILY_AGGR") \
            .filterBounds(target_geometry).filterDate(date_start, gee_end)

        if weather_collection.size().getInfo() > 0:
            weather_image = weather_collection.first()
            # МАСШТАБУВАННЯ ЗМІНЕНО НА 100 ДЛЯ ТОЧНОГО ЗАХВАТУ МАЛИХ ПОЛІВ
            temp_stats = weather_image.reduceRegion(
                reducer=ee.Reducer.mean(), geometry=target_geometry, scale=100)
            temp_kelvin = temp_stats.getInfo().get('temperature_2m')
            precip_m = temp_stats.getInfo().get('total_precipitation_sum')
            root_water_raw = temp_stats.getInfo().get('volumetric_soil_water_layer_2')

            real_temp = round(temp_kelvin - 273.15, 1) if temp_kelvin else 22.5
            precipitation = round(precip_m * 1000, 1) if precip_m else 0.0
            moisture_root = round(root_water_raw * 100,
                                  1) if root_water_raw else 35.0
        else:
            real_temp = 22.5
            precipitation = 0.0
            moisture_root = 35.0

        final_moisture = moisture_root if moisture_surface < 20 and moisture_root > 30 else moisture_surface

        def run_nowcasting(base_ndvi, age_days, start_date_str):
            if not base_ndvi or age_days <= 0:
                return base_ndvi
            gap_weather = ee.ImageCollection("ECMWF/ERA5_LAND/DAILY_AGGR") \
                .filterBounds(target_geometry).filterDate(start_date_str, gee_end)
            if gap_weather.size().getInfo() > 0:
                def calc_gdd(img):
                    return img.select('temperature_2m').subtract(273.15).subtract(10).max(0).rename('gdd')
                # ТУТ ТАКОЖ ЗМІНЕНО НА scale=100 ДЛЯ ОБЧИСЛЕННЯ ТЕПЛА
                gdd_total = gap_weather.map(calc_gdd).sum().reduceRegion(
                    reducer=ee.Reducer.mean(), geometry=target_geometry, scale=100)
                gdd_sum = gdd_total.getInfo().get('gdd') or 0
                return round(min(0.85, base_ndvi + ((gdd_sum * 0.0005) * (final_moisture / 50.0))), 3)
            return base_ndvi

        # === 2. ОКРЕМІ РОЗРАХУНКИ ДЛЯ КОЖНОГО СУПУТНИКА ===
        s2_res = {"raw": None, "synth": None, "age": 0}
        s2_col = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(
            target_geometry).filterDate(ndvi_start, gee_end).map(mask_s2_clouds)
        if s2_col.size().getInfo() > 0:
            img = s2_col.sort('CLOUDY_PIXEL_PERCENTAGE').first()
            d_str = img.date().format('YYYY-MM-dd').getInfo()
            s2_res["age"] = (
                target_date - datetime.strptime(d_str, "%Y-%m-%d")).days
            raw_val = img.normalizedDifference(['B8', 'B4']).rename('NDVI').reduceRegion(
                reducer=ee.Reducer.mean(), geometry=target_geometry, scale=10).get('NDVI').getInfo()
            if raw_val:
                s2_res["raw"] = round(raw_val, 3)
                s2_res["synth"] = run_nowcasting(raw_val, s2_res["age"], d_str)

        landsat_res = {"raw": None, "synth": None, "age": 0}
        l8_col = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2").filterBounds(
            target_geometry).filterDate(ndvi_start, gee_end).map(mask_landsat_clouds)
        l9_col = ee.ImageCollection("LANDSAT/LC09/C02/T1_L2").filterBounds(
            target_geometry).filterDate(ndvi_start, gee_end).map(mask_landsat_clouds)
        l_merged = l8_col.merge(l9_col)
        if l_merged.size().getInfo() > 0:
            img = l_merged.sort('CLOUD_COVER').first()
            d_str = img.date().format('YYYY-MM-dd').getInfo()
            landsat_res["age"] = (
                target_date - datetime.strptime(d_str, "%Y-%m-%d")).days
            raw_val = img.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI').reduceRegion(
                reducer=ee.Reducer.mean(), geometry=target_geometry, scale=30).get('NDVI').getInfo()
            if raw_val:
                landsat_res["raw"] = round(raw_val, 3)
                landsat_res["synth"] = run_nowcasting(
                    raw_val, landsat_res["age"], d_str)

        modis_res = {"raw": None, "synth": None, "age": 0}
        modis_col = ee.ImageCollection(
            "MODIS/061/MOD09GQ").filterBounds(target_geometry).filterDate(ndvi_start, gee_end)
        if modis_col.size().getInfo() > 0:
            img = modis_col.sort('system:time_start', False).first()
            d_str = img.date().format('YYYY-MM-dd').getInfo()
            modis_res["age"] = (
                target_date - datetime.strptime(d_str, "%Y-%m-%d")).days
            raw_val = img.normalizedDifference(['sur_refl_b02', 'sur_refl_b01']).rename('NDVI').reduceRegion(
                reducer=ee.Reducer.mean(), geometry=target_geometry, scale=250).get('NDVI').getInfo()
            if raw_val:
                modis_res["raw"] = round(raw_val, 3)
                modis_res["synth"] = run_nowcasting(
                    raw_val, modis_res["age"], d_str)

        # === 3. ПОВЕРТАЄМО СТРУКТУРОВАНИЙ ПАКЕТ ДАНИХ ===
        return {
            "status": "success",
            "temp": real_temp,
            "precip": precipitation,
            "moisture": final_moisture,
            "moisture_surface": moisture_surface,
            "moisture_root": moisture_root,
            "satellites": {
                "sentinel2": s2_res,
                "landsat": landsat_res,
                "modis": modis_res
            }
        }

    except Exception as e:
        print(f"ПОМИЛКА GEE: {e}")
        return {"error": str(e), "status": "error"}


@app.put("/api/fields/{field_id}")
def update_field(field_id: int, field: FieldCreate):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE fields 
        SET cadastre = ?, name = ?, crop = ?, area = ?, lat = ?, lon = ?, 
            variety = ?, planting_date = ?, prev_crop = ?, geometry = ?, soil_type = ?
        WHERE id = ?
    ''', (field.cadastre, field.name, field.crop, field.area, field.lat,
          field.lon, field.variety, field.planting_date, field.prev_crop, field.geometry, field.soil_type, field_id))
    conn.commit()
    conn.close()
    return {"status": "updated"}


@app.delete("/api/fields/{field_id}")
def delete_field(field_id: int):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM fields WHERE id = ?", (field_id,))
    conn.commit()
    conn.close()
    return {"status": "deleted"}


@app.get("/api/map_layers/{field_id}")
def get_map_layers(field_id: int, target_date: str):
    import sqlite3
    import json
    import ee
    from datetime import datetime, timedelta

    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT lat, lon, geometry FROM fields WHERE id = ?", (field_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return {"error": "Поле не знайдено"}
    lat, lon, geometry_str = row

    try:
        date_obj = datetime.strptime(target_date, "%Y-%m-%d")
        start_date = (date_obj - timedelta(days=30)).strftime("%Y-%m-%d")
        end_date = (date_obj + timedelta(days=1)).strftime("%Y-%m-%d")

        if geometry_str and geometry_str != "null":
            coords = json.loads(geometry_str)
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            roi = ee.Geometry.Polygon([coords])
        else:
            roi = ee.Geometry.Point([lon, lat]).buffer(100)

        s2_col = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(
            roi).filterDate(start_date, end_date).map(mask_s2_clouds)
        l8_col = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2").filterBounds(
            roi).filterDate(start_date, end_date).map(mask_landsat_clouds)
        l9_col = ee.ImageCollection("LANDSAT/LC09/C02/T1_L2").filterBounds(
            roi).filterDate(start_date, end_date).map(mask_landsat_clouds)
        modis_col = ee.ImageCollection(
            "MODIS/061/MOD09GQ").filterBounds(roi).filterDate(start_date, end_date)

        rgb_url = None
        ndvi_url = None
        active_sat_name = "Sentinel-2"

        if s2_col.size().getInfo() > 0:
            opt_image = s2_col.median().clip(roi)
            rgb_vis = {'bands': ['B4', 'B3', 'B2'], 'min': 200, 'max': 2500}
            ndvi_image = opt_image.normalizedDifference(['B8', 'B4'])
            active_sat_name = "Sentinel-2 (10m)"
        elif l8_col.size().getInfo() > 0 or l9_col.size().getInfo() > 0:
            l_merged = l8_col.merge(l9_col)
            opt_image = l_merged.median().clip(roi)
            rgb_vis = {'bands': ['SR_B4', 'SR_B3',
                                 'SR_B2'], 'min': 7000, 'max': 12000}
            ndvi_image = opt_image.normalizedDifference(['SR_B5', 'SR_B4'])
            active_sat_name = "Landsat 8/9 (30m)"
        elif modis_col.size().getInfo() > 0:
            opt_image = modis_col.median().clip(roi)
            rgb_vis = {'bands': ['sur_refl_b01', 'sur_refl_b01',
                                 'sur_refl_b01'], 'min': -100, 'max': 3000}
            ndvi_image = opt_image.normalizedDifference(
                ['sur_refl_b02', 'sur_refl_b01'])
            active_sat_name = "MODIS (250m)"
        else:
            opt_image = None

        if opt_image:
            rgb_mapid = opt_image.getMapId(rgb_vis)
            ndvi_vis = {'min': 0, 'max': 1,
                        'palette': ['red', 'yellow', 'green']}
            ndvi_mapid = ndvi_image.getMapId(ndvi_vis)
            rgb_url = rgb_mapid['tile_fetcher'].url_format
            ndvi_url = ndvi_mapid['tile_fetcher'].url_format

        radar_url = None
        try:
            sar_collection = ee.ImageCollection("COPERNICUS/S1_GRD") \
                .filterBounds(roi).filterDate(start_date, end_date) \
                .filter(ee.Filter.eq('instrumentMode', 'IW')) \
                .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
            if sar_collection.size().getInfo() > 0:
                sar_image = sar_collection.sort(
                    'system:time_start', False).first().clip(roi)
                sar_vis = {'bands': ['VV', 'VV', 'VV'], 'min': -25, 'max': 0}
                sar_mapid = sar_image.getMapId(sar_vis)
                radar_url = sar_mapid['tile_fetcher'].url_format
        except Exception as e:
            print(f"Помилка радару: {e}")

        return {
            "rgb_url": rgb_url,
            "ndvi_url": ndvi_url,
            "radar_url": radar_url,
            "sat_name": active_sat_name,
            "status": "success"
        }
    except Exception as e:
        print(f"Помилка створення шарів: {e}")
        return {"error": str(e)}


# Створюємо схему даних, які фронтенд буде надсилати для прогнозу


class ScenarioRequest(BaseModel):
    crop: str
    area: float
    price: float
    current_temp: float
    current_moisture: float
    current_ndvi: float
    month: int


@app.post("/api/forecast_scenarios")
def calculate_scenarios(req: ScenarioRequest):
    # 1. ТВОЯ БАЗА ДАНИХ З EXCEL (Параметри культур)
    crops_db = {
        'wheat': {'yield': 5.0, 'lMax': 0.80, 'tCrit': -9, 'tMax': 35},
        'corn': {'yield': 7.0, 'lMax': 0.90, 'tCrit': -2, 'tMax': 38},
        'sunflower': {'yield': 2.5, 'lMax': 0.70, 'tCrit': -3, 'tMax': 35},
        'rapeseed': {'yield': 3.2, 'lMax': 0.75, 'tCrit': -5, 'tMax': 30}
    }

    # Твої коефіцієнти "k" (швидкість накопичення ризику)
    k_heat = 0.005
    k_frost = 0.001
    k_moist = 0.003

    crop = crops_db.get(req.crop, crops_db['wheat'])

    # Ідеальна крива NDVI по місяцях
    ideal_ndvi_curve = {3: 0.25, 4: 0.45, 5: 0.70, 6: 0.75, 7: 0.50, 8: 0.30}
    target_ndvi = ideal_ndvi_curve.get(req.month, 0.30)

    # Функція розрахунку експоненційного ризику (з твоєї таблиці)
    def calc_risk(d_temp, d_moist, ndvi_gap):
        # Ризик температури: s = 1 - EXP(-k * D)
        s_temp = 1 - math.exp(-k_heat * d_temp) if d_temp > 0 else 0

        # Ризик вологи: s = 1 - EXP(-k * D)
        s_moist = 1 - math.exp(-k_moist * d_moist) if d_moist > 0 else 0

        # Ризик маси (NDVI)
        s_ndvi = max(0, ndvi_gap * 0.5)

        # Сумарний індекс ризику (не більше 1.0)
        total_s = min(1.0, s_temp + s_moist + s_ndvi)

        # Переводимо у відсоток втрат та фінанси
        loss_percent = total_s * crop['lMax']
        final_yield = crop['yield'] * (1 - loss_percent)
        revenue = req.area * final_yield * req.price

        return round(final_yield, 2), round(revenue), round(loss_percent * 100, 1)

    # ==========================================
    # 2. ГЕНЕРАЦІЯ СЦЕНАРІЇВ (НА 14 ДНІВ ВПЕРЕД)
    # ==========================================

    # БАЗОВИЙ ПОТЕНЦІАЛ (Якщо ризиків нуль)
    max_revenue = req.area * crop['yield'] * req.price

    # --- СЦЕНАРІЙ 1: ОПТИМІСТИЧНИЙ (Ідеальна погода) ---
    # Немає температурного стресу, волога відновлюється до 35%, рослина наздоганяє масу
    opt_yield, opt_rev, opt_loss = calc_risk(
        d_temp=0,
        d_moist=0,
        # Покращення NDVI
        ndvi_gap=max(0, target_ndvi - (req.current_ndvi + 0.1))
    )

    # --- СЦЕНАРІЙ 2: РЕАЛІСТИЧНИЙ (Тренд зберігається) ---
    # Легкий тепловий стрес (напр. 3 дні на 2°С вище норми по 4 год = 24 D)
    # Волога трохи падає (дефіцит 5% протягом 14 днів = 70 D)
    real_yield, real_rev, real_loss = calc_risk(
        d_temp=24,
        d_moist=70 if req.current_moisture < 35 else 0,
        ndvi_gap=max(0, target_ndvi - req.current_ndvi)  # NDVI не змінюється
    )

    # --- СЦЕНАРІЙ 3: ПЕСИМІСТИЧНИЙ (Засуха / Спека) ---
    # Жорсткий стрес (10 днів на 4°С вище норми по 6 год = 240 D)
    # Волога критично падає (дефіцит 15% протягом 14 днів = 210 D)
    pes_yield, pes_rev, pes_loss = calc_risk(
        d_temp=240,
        d_moist=210,
        # Деградація NDVI
        ndvi_gap=max(0, target_ndvi - (req.current_ndvi - 0.15))
    )

    return {
        "baseline_revenue": round(max_revenue),
        "scenarios": {
            "optimistic": {
                "name": "Оптимістичний (Сприятлива погода)",
                "yield": opt_yield,
                "revenue": opt_rev,
                "loss_percent": opt_loss,
                "desc": "Відновлення вегетації, відсутність теплових стресів."
            },
            "realistic": {
                "name": "Реалістичний (Історична норма)",
                "yield": real_yield,
                "revenue": real_rev,
                "loss_percent": real_loss,
                "desc": "Збереження поточних тенденцій вегетації."
            },
            "pessimistic": {
                "name": "Песимістичний (Засуха та спека)",
                "yield": pes_yield,
                "revenue": pes_rev,
                "loss_percent": pes_loss,
                "desc": "Тривалий дефіцит вологи та температурні шоки."
            }
        }
    }
