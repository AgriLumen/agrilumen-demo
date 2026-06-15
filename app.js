// ==========================================
// 1. КОНФІГУРАЦІЯ ТА ДАНІ
// ==========================================
const AGRI_MODEL = {
    crops: {
        'wheat': { yield: 5, price: 6000, lMax: 0.80, tCrit: -9, tMax: 35 },
        'corn': { yield: 7, price: 6500, lMax: 0.90, tCrit: -2, tMax: 38 },
        'sunflower': { yield: 2.5, price: 14000, lMax: 0.70, tCrit: -3, tMax: 35 },
        'rapeseed': { yield: 3.2, price: 15000, lMax: 0.75, tCrit: -5, tMax: 30 }
    },
    k_factors: { frost: 0.001, heat: 0.005 }
};

// Зробили масив порожнім, тепер він буде заповнюватися з бази даних
let userFields = [];
let editingRowId = null; // Зберігає ID рядка, який зараз редагується
let charts = { dashboard: null, analytics: null };
let mapInstance = null;

// --- НОВІ ЗМІННІ ДЛЯ МІНІ-КАРТИ АНАЛІТИКИ ---
window.analyticsMapInstance = null;
window.analyticsLayerControl = null;
window.analyticsPolygonLayer = null;
// --------------------------------------------
// ==========================================
// ==========================================
// 2. ЗВ'ЯЗОК З БАЗОЮ ДАНИХ (FASTAPI)
// ==========================================
async function loadFieldsFromDB() {
    try {
        const response = await fetch('https://agrilumen-demo.onrender.com/api/fields');
        if (!response.ok) throw new Error('Мережева помилка');
        const fields = await response.json();

        userFields = fields.map(f => ({
            id: f[0],
            cadastre: f[1],
            field: f[2],
            crop: f[3],
            area: f[4],
            lat: f[5],
            lon: f[6],
            variety: f[7] || "Стандарт",
            planting_date: f[8] || "Не вказано",
            prev_crop: f[9] || "Невідомо",
            geometry: f[10] || null,
            soil_type: f[11] || "Чорнозем" // <-- Зчитуємо ґрунт з БД
        }));

        updateFarmTableUI();
        updateAnalyticsFieldSelector();
    } catch (error) {
        console.error("Помилка завантаження полів з БД:", error);
    }
}



// НОВА ФУНКЦІЯ: заповнює випадаючий список полів
function updateAnalyticsFieldSelector() {
    const select = document.getElementById('forecast-field-select');
    if (!select) return;

    select.innerHTML = '';
    if (userFields.length === 0) {
        select.innerHTML = '<option value="">Спочатку додайте поле</option>';
        return;
    }

    userFields.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.innerText = `${f.field} (${f.area} га)`;
        select.appendChild(opt);
    });
}
// ==========================================
// 3. ДАШБОРД
// ==========================================
function initDashboardChart() {
    const ctx = document.getElementById('dashboardChart');
    if (!ctx) return;
    if (charts.dashboard) charts.dashboard.destroy();

    charts.dashboard = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Березень', 'Квітень', 'Травень', 'Червень', 'Липень'],
            datasets: [{
                label: 'NDVI',
                data: [0.32, 0.45, 0.64, 0.78, 0.60],
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

// ==========================================
// 4. МОЯ ФЕРМА (Керування таблицею)
// ==========================================

// ---> ВСТАВ НОВУ ФУНКЦІЮ ОСЬ ТУТ <---
function focusFieldOnMap(lat, lon, name) {
    if (!mapInstance) return;

    // Перемикаємо вкладку на "Моя ферма", якщо ми на іншій
    switchTab('myfarm');

    // Плавний переліт камери до координат поля
    mapInstance.flyTo([lat, lon], 16, {
        animate: true,
        duration: 1.5
    });

    // Тимчасовий маркер, щоб підсвітити центр
    L.popup()
        .setLatLng([lat, lon])
        .setContent(`<b>${name}</b>`)
        .openOn(mapInstance);
}

// ---> ДАЛІ ЙДЕ ТВОЯ СТАРА ФУНКЦІЯ <---
// ---> ПОВНІСТЮ ОНОВЛЕНА ФУНКЦІЯ <---
function updateFarmTableUI() {
    const tbody = document.getElementById('farm-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    userFields.forEach(item => {
        // ЯКЩО РЯДОК У РЕЖИМІ РЕДАГУВАННЯ
        if (item.id === editingRowId) {
            tbody.innerHTML += `
                <tr class="bg-green-50/50 border-b">
                    <td class="px-3 py-3">
                        <input type="text" id="edit-name-${item.id}" value="${item.field}" class="w-full p-1.5 text-sm border border-green-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-green-500">
                    </td>
                    <td class="px-3 py-3">
                        <select id="edit-crop-${item.id}" class="w-full p-1.5 text-sm border border-green-300 rounded shadow-sm focus:outline-none">
                            <option value="wheat" ${item.crop === 'wheat' ? 'selected' : ''}>wheat</option>
                            <option value="corn" ${item.crop === 'corn' ? 'selected' : ''}>corn</option>
                            <option value="sunflower" ${item.crop === 'sunflower' ? 'selected' : ''}>sunflower</option>
                            <option value="rapeseed" ${item.crop === 'rapeseed' ? 'selected' : ''}>rapeseed</option>
                            <option value="soybeans" ${item.crop === 'soybeans' ? 'selected' : ''}>soybeans</option>
                            <option value="barley" ${item.crop === 'barley' ? 'selected' : ''}>barley</option>
                        </select>
                    </td>
                    <td class="px-3 py-3 flex items-center gap-1">
                        <input type="number" step="0.01" id="edit-area-${item.id}" value="${item.area}" class="w-20 p-1.5 text-sm border border-green-300 rounded shadow-sm focus:outline-none"> га
                    </td>
                    <td class="px-3 py-3">
                        <select id="edit-variety-${item.id}" class="w-full p-1.5 text-sm border border-green-300 rounded shadow-sm focus:outline-none">
                            <option value="Стандарт" ${item.variety === 'Стандарт' ? 'selected' : ''}>Стандарт</option>
                            <option value="Степова-1" ${item.variety === 'Степова-1' ? 'selected' : ''}>Степова-1 (Пшениця)</option>
                            <option value="Ярум-2" ${item.variety === 'Ярум-2' ? 'selected' : ''}>Ярум-2 (Пшениця)</option>
                            <option value="Маїс-5" ${item.variety === 'Маїс-5' ? 'selected' : ''}>Маїс-5 (Кукурудза)</option>
                            <option value="Літній-3" ${item.variety === 'Літній-3' ? 'selected' : ''}>Літній-3 (Соняшник)</option>
                            <option value="Золоте-1" ${item.variety === 'Золоте-1' ? 'selected' : ''}>Золоте-1 (Ячмінь)</option>
                            <option value="Весняний" ${item.variety === 'Весняний' ? 'selected' : ''}>Весняний (Ріпак)</option>
                        </select>
                    </td>
                    <td class="px-3 py-3">
                        <input type="date" id="edit-date-${item.id}" value="${item.planting_date === 'Не вказано' ? '' : item.planting_date}" class="w-full p-1.5 text-sm border border-green-300 rounded shadow-sm focus:outline-none">
                    </td>
                    <td class="px-3 py-3">
                        <select id="edit-prev-${item.id}" class="w-full p-1.5 text-sm border border-green-300 rounded shadow-sm focus:outline-none">
                            <option value="Невідомо" ${item.prev_crop === 'Невідомо' ? 'selected' : ''}>Невідомо</option>
                            <option value="Пшениця" ${item.prev_crop === 'Пшениця' ? 'selected' : ''}>Пшениця</option>
                            <option value="Кукурудза" ${item.prev_crop === 'Кукурудза' ? 'selected' : ''}>Кукурудза</option>
                            <option value="Соняшник" ${item.prev_crop === 'Соняшник' ? 'selected' : ''}>Соняшник</option>
                            <option value="Ріпак" ${item.prev_crop === 'Ріпак' ? 'selected' : ''}>Ріпак</option>
                            <option value="Соя" ${item.prev_crop === 'Соя' ? 'selected' : ''}>Соя</option>
                            <option value="Ячмінь" ${item.prev_crop === 'Ячмінь' ? 'selected' : ''}>Ячмінь</option>
                            <option value="Чорний пар" ${item.prev_crop === 'Чорний пар' ? 'selected' : ''}>Чорний пар</option>
                        </select>
                    </td>
                    <td class="px-3 py-3 text-right">
                        <div class="flex justify-end gap-3">
                            <button onclick="saveRowEdit(${item.id})" class="text-emerald-600 hover:text-emerald-800 bg-emerald-100 p-1.5 rounded" title="Зберегти">
                                <i class="fa-solid fa-check"></i>
                            </button>
                            <button onclick="cancelRowEdit()" class="text-rose-500 hover:text-rose-700 bg-rose-100 p-1.5 rounded" title="Скасувати">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }
        // ЯКЩО РЯДОК У ЗВИЧАЙНОМУ РЕЖИМІ ПЕРЕГЛЯДУ
        else {
            tbody.innerHTML += `
                <tr class="hover:bg-gray-50 transition-colors border-b">
                    <td class="px-5 py-4 font-bold text-green-700 underline cursor-pointer" 
                        onclick="focusFieldOnMap(${item.lat}, ${item.lon}, '${item.field}')">
                        ${item.field}
                    </td>
                    <td class="px-5 py-4"><span class="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-bold uppercase">${item.crop}</span></td>
                    <td class="px-5 py-4 font-medium">${item.area} га</td>
                    <td class="px-5 py-4 text-gray-600">${item.variety || '-'}</td>
                    <td class="px-5 py-4 text-gray-600">${item.planting_date || '-'}</td>
                    <td class="px-5 py-4 text-gray-600">${item.prev_crop || '-'}</td>
                    <td class="px-5 py-4 text-right">
                        <div class="flex justify-end gap-3">
                            <button onclick="startRowEdit(${item.id})" class="text-blue-500 hover:text-blue-700 transition-transform hover:scale-110" title="Редагувати">
                                <i class="fa-solid fa-pen-to-square"></i>
                            </button>
                            <button onclick="removeField(${item.id})" class="text-rose-400 hover:text-rose-600 transition-transform hover:scale-110" title="Видалити">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }
    });
    // Рахуємо загальну площу всіх полів
    const totalArea = userFields.reduce((sum, field) => sum + parseFloat(field.area || 0), 0);

    // Якщо в HTML є місце для виводу площі - оновлюємо його (можеш додати id="total-farm-area" кудись у заголовок)
    const totalAreaEl = document.getElementById('total-farm-area');
    if (totalAreaEl) totalAreaEl.innerText = `${totalArea.toFixed(2)} га`;
}


async function addNewField() {
    if (!window.drawnPolygonCoords) {
        alert("Будь ласка, спочатку обведіть поле на карті!");
        return;
    }

    const fieldName = prompt("Назва поля:", `Поле №${userFields.length + 1}`);
    if (!fieldName) return;

    const cropInput = prompt("Культура (wheat, corn, sunflower, rapeseed):", "wheat");
    const variety = prompt("Сорт або гібрид:", "Стандарт");
    const pDate = prompt("Дата посіву (РРРР-ММ-ДД):", new Date().toISOString().split('T')[0]);
    const prev = prompt("Попередник:", "Невідомо");

    // ЖОРСТКА перевірка на числа, щоб ніколи не відправлявся null
    const safeArea = parseFloat(window.drawnArea) || 0.0;
    const safeLat = parseFloat(window.lastClickedLat) || 0.0;
    const safeLon = parseFloat(window.lastClickedLon) || 0.0;

    const newField = {
        cadastre: "Контур з карти",
        name: fieldName,
        crop: cropInput || "wheat",
        area: safeArea,
        lat: safeLat,
        lon: safeLon,
        variety: variety || "Стандарт",
        planting_date: pDate || new Date().toISOString().split('T')[0],
        prev_crop: prev || "Невідомо",
        geometry: JSON.stringify(window.drawnPolygonCoords),
        soil_type: "Чорнозем"
    };

    console.log("📦 Відправляємо на сервер:", newField); // Виведемо в консоль те, що відправляємо

    try {
        const response = await fetch('https://agrilumen-demo.onrender.com/api/fields', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newField)
        });

        if (response.ok) {
            await loadFieldsFromDB();
            if (typeof drawnItems !== 'undefined' && drawnItems) drawnItems.clearLayers();
            window.drawnPolygonCoords = null;
            alert("Поле успішно додано!");
        } else {
            // Тепер ми витягнемо точну причину від Python і покажемо її
            const errData = await response.json();
            console.error("🚨 Python каже (деталі помилки 422):", JSON.stringify(errData, null, 2));
            alert(`Помилка валідації! Відкрий консоль (F12), щоб побачити, яке саме поле не сподобалося серверу.`);
        }
    } catch (error) {
        alert(`Сервер не відповідає. Перевір чорний термінал Python!\nПомилка: ${error.message}`);
    }
}

function startRowEdit(id) {
    editingRowId = id;
    updateFarmTableUI();
}

function cancelRowEdit() {
    editingRowId = null;
    updateFarmTableUI();
}

async function saveRowEdit(id) {
    const field = userFields.find(f => f.id === id);
    if (!field) return;

    // Збираємо дані з input-полів
    const newName = document.getElementById(`edit-name-${id}`).value;
    const newCrop = document.getElementById(`edit-crop-${id}`).value;
    const newArea = parseFloat(document.getElementById(`edit-area-${id}`).value);
    const newVariety = document.getElementById(`edit-variety-${id}`).value;
    const newDate = document.getElementById(`edit-date-${id}`).value;
    const newPrev = document.getElementById(`edit-prev-${id}`).value;

    if (!newName || isNaN(newArea)) {
        alert("Назва поля та площа обов'язкові!");
        return;
    }

    const updatedData = {
        cadastre: field.cadastre,
        name: newName,
        crop: newCrop,
        area: newArea,
        lat: field.lat,
        lon: field.lon,
        variety: newVariety || "Не вказано",
        planting_date: newDate || "Не вказано",
        prev_crop: newPrev || "Невідомо",
        geometry: field.geometry
    };

    try {
        // Візуально показуємо процес завантаження на кнопці
        const saveBtn = document.querySelector(`button[onclick="saveRowEdit(${id})"]`);
        if (saveBtn) saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

        const response = await fetch(`https://agrilumen-demo.onrender.com/api/fields/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedData)
        });

        if (response.ok) {
            editingRowId = null; // Виходимо з режиму редагування
            await loadFieldsFromDB(); // Перезавантажуємо таблицю чистими даними
        } else {
            const errText = await response.text();
            alert(`Помилка сервера:\n${errText}`);
            cancelRowEdit();
        }
    } catch (error) {
        alert(`Сервер не відповідає!\nПомилка: ${error.message}`);
        cancelRowEdit();
    }
}

// Локальне видалення (для MVP)
async function removeField(id) {
    if (!confirm("Ви впевнені, що хочете видалити це поле?")) return;

    try {
        const response = await fetch(`https://agrilumen-demo.onrender.com/api/fields/${id}`, {
            method: 'DELETE'
        });
        if (response.ok) {
            await loadFieldsFromDB(); // Перезавантажуємо чисті дані з бази
            alert("Поле видалено назавжди.");
        }
    } catch (error) {
        console.error("Помилка видалення:", error);
    }
}

// ==========================================
// 5. АНАЛІТИКА (Календар та Погода)
// ==========================================
// Запасна функція, якщо сервер вимкнено
function getMockWeather(dateString) {
    const date = new Date(dateString);
    const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
    return parseFloat((12 + 18 * Math.sin((dayOfYear - 105) * 2 * Math.PI / 365) + ((Math.random() * 8) - 4)).toFixed(1));
}

// Оновлена асинхронна функція з підключенням до API
// Оновлена асинхронна функція з підключенням до API
// Оновлена асинхронна функція з підключенням до API
// Оновлена асинхронна функція з підключенням до API та візуалізацією
// Оновлена асинхронна функція з підключенням до API
// Оновлена асинхронна функція з підключенням до API (Мультисенсорна)
async function calculateByDate() {
    const dateVal = document.getElementById('forecast-date').value;
    const cropKey = document.getElementById('forecast-crop').value;
    const select = document.getElementById('forecast-field-select');
    const fieldId = parseInt(select.value);

    if (!fieldId) {
        alert("Спочатку виберіть або додайте поле!");
        return;
    }

    const lossEl = document.getElementById('display-loss');
    if (lossEl) lossEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Аналізуємо космос...`;

    // --- ЛОГІКА ПРОГРЕС-БАРУ (ДОДАНО) ---
    const loader = document.getElementById('analytics-loader');
    const loaderBar = document.getElementById('loader-bar');
    const loaderText = document.getElementById('loader-text');
    const loaderPercent = document.getElementById('loader-percent');

    const updateProgress = (pct, text) => {
        if (loaderBar) loaderBar.style.width = `${pct}%`;
        if (loaderPercent) loaderPercent.innerText = `${pct}%`;
        if (text && loaderText) loaderText.innerText = text;
    };

    if (loader) {
        loader.classList.remove('hidden');
        loader.classList.add('flex');
    }
    updateProgress(5, "Ініціалізація запиту до бази даних...");

    // Імітація процесу для важких операцій
    let fakeProgress = setTimeout(() => updateProgress(25, "Отримання радарних даних (Sentinel-1)..."), 1500);
    let fakeProgress2 = setTimeout(() => updateProgress(45, "Розрахунок індексу вологи та температури..."), 3500);
    let fakeProgress3 = setTimeout(() => updateProgress(60, "Завантаження мультиспектральних знімків..."), 6000);
    // -------------------------------------

    try {
        // 1. ЗАПИТ ДО НАШОГО PYTHON-СЕРВЕРА (Супутники та Кліматичні моделі)
        const response = await fetch(`https://agrilumen-demo.onrender.com/api/analyze/${fieldId}?date_start=${dateVal}&date_end=${dateVal}`);

        // Як тільки сервер відповів, чистимо таймери прогрес-бару
        clearTimeout(fakeProgress); clearTimeout(fakeProgress2); clearTimeout(fakeProgress3);
        updateProgress(75, "Дані отримано! Моделювання кліматичних ризиків...");

        const realData = await response.json();

        if (realData.error) {
            if (loader) { loader.classList.add('hidden'); loader.classList.remove('flex'); }
            alert("Помилка супутника: " + realData.error);
            if (lossEl) lossEl.innerText = `Помилка`;
            return;
        }

        const currentField = userFields.find(f => f.id === fieldId);
        const area = currentField ? currentField.area : 100;
        const fieldLat = currentField ? currentField.lat : 49.0;
        const fieldLon = currentField ? currentField.lon : 33.0;

        // === 2. ЗАПИТ ДО OPEN-METEO (Миттєва температура повітря як на Синоптику) ===
        let airTemp = realData.temp; // Запасний варіант, якщо API впаде
        let airPrecip = realData.precip || 0.0;

        try {
            const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${fieldLat}&longitude=${fieldLon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&start_date=${dateVal}&end_date=${dateVal}&timezone=auto`;
            const meteoResp = await fetch(meteoUrl);
            if (meteoResp.ok) {
                const meteoData = await meteoResp.json();
                if (meteoData && meteoData.daily && meteoData.daily.temperature_2m_max.length > 0) {
                    // Рахуємо середню температуру повітря за день
                    const tMax = meteoData.daily.temperature_2m_max[0];
                    const tMin = meteoData.daily.temperature_2m_min[0];
                    airTemp = (tMax + tMin) / 2;
                    airPrecip = meteoData.daily.precipitation_sum[0] ?? 0.0;
                }
            }
        } catch (e) {
            console.warn("Open-Meteo API не відповідає, використовуємо супутникову погоду", e);
        }

        // === 3. РОЗПАКОВУЄМО ДАНІ З PYTHON ===
        const satTemp = realData.temp; // Температура нагріву поля (LST / GLDAS)
        const moisture = realData.moisture || 0;
        const surfMoist = realData.moisture_surface || 0;
        const rootMoist = realData.moisture_root || 0;

        // === 4. АЛГОРИТМ ДОВІРИ (CONFIDENCE SCORE) ===
        const s2 = realData.satellites.sentinel2;
        const landsat = realData.satellites.landsat;
        const modis = realData.satellites.modis;

        let bestSat = null;
        let warningHtml = "";

        if (s2.raw !== null && s2.age <= 14) {
            bestSat = { ...s2, name: 'Sentinel-2 (10m)', badge: 'Найвища точність', color: 'text-emerald-600' };
        } else if (landsat.raw !== null && landsat.age <= 14) {
            bestSat = { ...landsat, name: 'Landsat 8/9 (30m)', badge: 'Середня точність', color: 'text-blue-600' };
        } else {
            let candidates = [];
            if (s2.raw !== null) candidates.push({ ...s2, name: 'Sentinel-2 (10m)' });
            if (landsat.raw !== null) candidates.push({ ...landsat, name: 'Landsat 8/9 (30m)' });
            if (modis.raw !== null) candidates.push({ ...modis, name: 'MODIS (250m)' });

            if (candidates.length > 0) {
                let oldestBest = candidates.reduce((prev, curr) => prev.age < curr.age ? prev : curr);
                bestSat = { ...oldestBest, badge: 'Низька точність', color: 'text-rose-600' };
                warningHtml = `
                    <div class="mt-2 p-2 bg-rose-50 border border-rose-200 rounded text-[9px] text-rose-700 leading-tight">
                        <i class="fa-solid fa-triangle-exclamation"></i> <strong>Увага:</strong> Тривала хмарність. Використано глибокий Nowcast (${bestSat.age} дн).
                    </div>
                `;
            } else {
                bestSat = { raw: null, synth: (moisture < 35 ? 0.3 : 0.6), age: 0, name: 'Радарний бекап', badge: 'Критично', color: 'text-gray-500' };
            }
        }

        let finalNdviToUse = bestSat.synth;

        // === 5. ЗАПОБІЖНИК ВІД СНІГУ ТА ВОДИ ===
        const selectedDateObj = new Date(dateVal);
        const month = selectedDateObj.getMonth() + 1;
        const isWinter = [12, 1, 2, 3].includes(month);

        if (finalNdviToUse < 0.15 && !isWinter) {
            if (loader) { loader.classList.add('hidden'); loader.classList.remove('flex'); }
            if (lossEl) lossEl.innerText = `Нецільова ділянка`;
            alert(`🛰️ Розрахунковий NDVI = ${finalNdviToUse.toFixed(2)}. Показник занадто низький для вегетації!`);
            return;
        }

        // === 6. ЗВ'ЯЗОК З PYTHON ДЛЯ СЦЕНАРНОГО ПРОГНОЗУВАННЯ ===
        updateProgress(85, "Генерація фінансових сценаріїв...");
        const crop = AGRI_MODEL.crops[cropKey] || AGRI_MODEL.crops['wheat'];
        const targetMonth = new Date(dateVal).getMonth() + 1;

        // Збираємо дані для бекенду
        const scenarioPayload = {
            crop: cropKey,
            area: parseFloat(area),
            price: crop.price,
            current_temp: satTemp,
            current_moisture: moisture,
            current_ndvi: finalNdviToUse,
            month: targetMonth
        };

        // Показуємо блок сценаріїв і крутилки завантаження
        const wrapper = document.getElementById('scenarios-wrapper');
        if (wrapper) wrapper.classList.remove('hidden');

        const realRevEl = document.getElementById('real-rev');
        if (realRevEl) realRevEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

        // Ховаємо старий блок єдиного збитку
        const oldLossBlock = document.getElementById('display-loss');
        if (oldLossBlock) oldLossBlock.parentElement.classList.add('hidden');

        try {
            // Відправляємо POST-запит на Python-сервер
            const scenResp = await fetch('https://agrilumen-demo.onrender.com/api/forecast_scenarios', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(scenarioPayload)
            });

            if (scenResp.ok) {
                const scenData = await scenResp.json();

                // Заповнюємо Оптимістичний сценарій
                const optY = document.getElementById('opt-yield');
                const optR = document.getElementById('opt-rev');
                if (optY) optY.innerText = scenData.scenarios.optimistic.yield.toFixed(1) + ' т/га';
                if (optR) optR.innerText = scenData.scenarios.optimistic.revenue.toLocaleString('uk-UA') + ' грн';

                // Заповнюємо Реалістичний сценарій
                const realY = document.getElementById('real-yield');
                const realR = document.getElementById('real-rev');
                if (realY) realY.innerText = scenData.scenarios.realistic.yield.toFixed(1) + ' т/га';
                if (realR) realR.innerText = scenData.scenarios.realistic.revenue.toLocaleString('uk-UA') + ' грн';

                // Заповнюємо Песимістичний сценарій
                const pesY = document.getElementById('pes-yield');
                const pesR = document.getElementById('pes-rev');
                if (pesY) pesY.innerText = scenData.scenarios.pessimistic.yield.toFixed(1) + ' т/га';
                if (pesR) pesR.innerText = scenData.scenarios.pessimistic.revenue.toLocaleString('uk-UA') + ' грн';

                // Малюємо графік на основі реалістичного ризику
                const realRiskValue = scenData.scenarios.realistic.loss_percent / 100;
                renderRiskChart(realRiskValue, 'none');
            }
        } catch (e) {
            console.error("Не вдалося завантажити сценарний прогноз", e);
            if (realRevEl) realRevEl.innerText = "Помилка сервера";
        }

        // === 7. ОНОВЛЕННЯ ІНТЕРФЕЙСУ (Сирі дані) ===
        updateProgress(95, "Рендеринг теплової мапи...");
        const weatherDescEl = document.getElementById('model-weather-desc');
        if (weatherDescEl) weatherDescEl.innerHTML = `<i class="fa-solid fa-temperature-half"></i> Повітря: ${airTemp.toFixed(1)}°C | <i class="fa-solid fa-cloud-rain"></i> Опади: ${airPrecip} мм`;

        const rawDataPanel = document.getElementById('satellite-raw-data');
        if (rawDataPanel) rawDataPanel.classList.remove('hidden');

        // Відмальовка NDVI
        const ndviEl = document.getElementById('raw-ndvi-val');
        if (ndviEl) {
            ndviEl.innerHTML = `
                <div class="flex justify-between items-center mb-1 mt-1">
                    <span class="text-[11px] text-gray-700 font-bold">${bestSat.name}</span>
                    <span class="text-[9px] px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">${bestSat.badge}</span>
                </div>
                <div class="flex items-end gap-2">
                    <span class="${bestSat.color} font-black text-2xl">${finalNdviToUse.toFixed(3)}</span>
                    <span class="text-[10px] text-gray-500 pb-1">${bestSat.age > 2 ? `Nowcast (${bestSat.age} дн)` : 'Свіжий знімок'}</span>
                </div>
                ${warningHtml}
            `;
        }

        // Відмальовка Температури
        const tempEl = document.getElementById('raw-temp-val');
        if (tempEl) {
            let tempStatus = '<span class="text-emerald-600 font-bold text-[10px] uppercase">Оптимально</span>';
            if (satTemp < crop.tCrit) tempStatus = `<span class="text-blue-600 font-bold text-[10px] uppercase">Стрес (Холод)</span>`;
            if (satTemp > crop.tMax) tempStatus = `<span class="text-rose-600 font-bold text-[10px] uppercase">Стрес (Спека)</span>`;

            tempEl.innerHTML = `
                <div class="flex justify-between border-b border-gray-100 pb-1 mb-1 mt-1">
                    <span class="text-[11px] text-gray-700 font-medium">Повітря (Синоптик)</span>
                    <span class="text-slate-800 font-bold text-sm">${airTemp.toFixed(1)}°C</span>
                </div>
                <div class="flex justify-between border-b border-gray-100 pb-1 mb-1">
                    <span class="text-[11px] text-gray-700 font-medium">Поле (Супутник)</span>
                    <span class="text-rose-600 font-bold text-sm">${satTemp.toFixed(1)}°C</span>
                </div>
                <div class="flex justify-between items-center mt-1">
                    <span class="text-[11px] text-gray-700 font-bold">Стан рослини</span>
                    ${tempStatus}
                </div>
            `;
        }

        // Відмальовка Вологи
        const moistureEl = document.getElementById('raw-moisture-val');
        if (moistureEl) {
            moistureEl.innerHTML = `
                <div class="flex justify-between border-b border-gray-100 pb-1 mb-1 mt-1">
                    <span class="text-[11px] text-gray-700 font-medium italic">Радар (Поверхня)</span>
                    <span class="text-blue-600 font-bold">${surfMoist.toFixed(1)}%</span>
                </div>
                <div class="flex justify-between border-b border-gray-100 pb-1 mb-1">
                    <span class="text-[11px] text-gray-700 font-medium italic">NASA (Коріння)</span>
                    <span class="text-emerald-600 font-bold">${rootMoist.toFixed(1)}%</span>
                </div>
                <div class="flex justify-between mt-1">
                    <span class="text-[11px] text-gray-700 font-bold">Розрахункова база</span>
                    <span class="text-slate-800 font-black">${moisture.toFixed(1)}%</span>
                </div>
            `;
        }

        // === 8. КАРТА ===
        const mapContainer = document.getElementById('analytics-map');
        if (mapContainer && currentField) {
            if (!window.analyticsMapInstance) {
                window.analyticsMapInstance = L.map('analytics-map', { zoomControl: true });
                L.tileLayer('http://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { maxZoom: 20, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'] }).addTo(window.analyticsMapInstance);
            }
            setTimeout(() => window.analyticsMapInstance.invalidateSize(), 100);

            if (window.analyticsPolygonLayer) window.analyticsMapInstance.removeLayer(window.analyticsPolygonLayer);
            if (window.satelliteRgbLayer) window.analyticsMapInstance.removeLayer(window.satelliteRgbLayer);
            if (window.satelliteNdviLayer) window.analyticsMapInstance.removeLayer(window.satelliteNdviLayer);
            if (window.satelliteRadarLayer) window.analyticsMapInstance.removeLayer(window.satelliteRadarLayer);
            if (window.analyticsLayerControl) { window.analyticsMapInstance.removeControl(window.analyticsLayerControl); window.analyticsLayerControl = null; }

            window.analyticsMapInstance.setView([currentField.lat, currentField.lon], 15);

            if (currentField.geometry && currentField.geometry !== "null") {
                const coords = JSON.parse(currentField.geometry);
                const leafletCoords = coords.map(p => [p[1], p[0]]);
                window.analyticsPolygonLayer = L.polygon(leafletCoords, { color: "#15803d", fillColor: "transparent", weight: 3 }).addTo(window.analyticsMapInstance);
            }

            try {
                const tileResp = await fetch(`https://agrilumen-demo.onrender.com/api/map_layers/${fieldId}?target_date=${dateVal}`);
                const tileData = await tileResp.json();

                if (tileData.status === "success") {
                    const overlayMaps = {};
                    if (tileData.ndvi_url) {
                        window.satelliteNdviLayer = L.tileLayer(tileData.ndvi_url, { opacity: 0.9, zIndex: 10 }).addTo(window.analyticsMapInstance);
                        overlayMaps["🌡️ Теплова мапа (" + tileData.sat_name + ")"] = window.satelliteNdviLayer;
                    }
                    if (tileData.rgb_url) {
                        window.satelliteRgbLayer = L.tileLayer(tileData.rgb_url, { opacity: 1.0, zIndex: 10 });
                        overlayMaps["📸 Реальне фото (RGB)"] = window.satelliteRgbLayer;
                    }
                    if (tileData.radar_url) {
                        window.satelliteRadarLayer = L.tileLayer(tileData.radar_url, { opacity: 1.0, zIndex: 11 });
                        overlayMaps["📡 Радар (Волога)"] = window.satelliteRadarLayer;
                    }
                    window.analyticsLayerControl = L.control.layers(null, overlayMaps, { collapsed: false }).addTo(window.analyticsMapInstance);
                }
            } catch (e) {
                console.error("Не вдалося завантажити фото шари:", e);
            }
        }

        // Завершуємо завантаження
        updateProgress(100, "Готово!");
        setTimeout(() => {
            if (loader) { loader.classList.add('hidden'); loader.classList.remove('flex'); }
        }, 600);

    } catch (error) {
        console.error("Помилка розрахунку:", error);
        if (loader) { loader.classList.add('hidden'); loader.classList.remove('flex'); }
        if (lossEl) lossEl.innerText = `Помилка з'єднання`;
    }
}


function renderRiskChart(kValue, type) {
    const ctx = document.getElementById('probabilityChart');
    if (!ctx) return;
    if (charts.analytics) charts.analytics.destroy();
    charts.analytics = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [0, 100, 200, 300, 400, 500],
            datasets: [{
                label: 'Risk Curve',
                data: [0, 100 * kValue, 200 * kValue, 300 * kValue, 400 * kValue, 500 * kValue],
                borderColor: '#15803d',
                fill: true
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

// --- ДОПОМІЖНА ФУНКЦІЯ: Перетворює NDVI в агрономічний колір ---
function getNdviColor(ndviVal) {
    if (ndviVal < 0.15) return '#ef4444'; // Яскраво-Червоний (Вода/Стрес)
    if (ndviVal < 0.4) return '#f97316'; // Жовтогарячий (Голий ґрунт)
    if (ndviVal < 0.7) return '#a3e635'; // Салатовий (Норма)
    return '#15803d'; // Темно-Зелений (Густа біомаса)
}
// ==========================================
// 6. НАВІГАЦІЯ
// ==========================================
function switchTab(tabId) {
    try {
        // 1. Ховаємо всі вкладки
        document.querySelectorAll('.content-tab').forEach(tab => tab.classList.add('hidden'));
        document.getElementById('tab-hero').classList.add('hidden');
        document.getElementById('platform-ui').classList.remove('hidden');

        // 2. Показуємо потрібну
        const target = document.getElementById(`content-${tabId}`);
        if (target) target.classList.remove('hidden');

        // 3. Робимо кнопку активною
        document.querySelectorAll('.nav-link').forEach(btn => btn.classList.remove('active'));
        const btn = document.getElementById(`btn-${tabId}`);
        if (btn) btn.classList.add('active');

        // 4. Запускаємо логіку вкладки
        if (tabId === 'dashboard') initDashboardChart();

        // ---> ОСЬ ТУТ ЗМІНЕНО: прибрано calculateByDate() і додано оновлення розміру карти <---
        if (tabId === 'analytics') {
            if (window.analyticsMapInstance) {
                setTimeout(() => window.analyticsMapInstance.invalidateSize(), 100);
            }
        }
        // --------------------------------------------------------------------------------------

        if (tabId === 'myfarm') {
            updateFarmTableUI();
            setTimeout(() => {
                initMapOnce();
                if (typeof displaySavedPolygons === 'function') {
                    displaySavedPolygons();
                }
            }, 200);
        }
    } catch (error) {
        console.error(`Не критична помилка при перемиканні на вкладку ${tabId}:`, error);
        // Вкладка все одно відкриється, навіть якщо графіка чи карта видала збій
    }
}
// --- ЗМІННІ ДЛЯ КАРТИ ---
window.drawnPolygonCoords = null;
window.satelliteRgbLayer = null;
window.satelliteNdviLayer = null;
window.mapLayerControl = null;
let drawnItems = null;

function initMapOnce() {
    if (mapInstance) {
        // Даємо браузеру 100 мілісекунд, щоб відкрити вкладку, а потім будимо карту
        setTimeout(() => mapInstance.invalidateSize(), 100);
        return;
    }

    const container = document.getElementById('field-map');
    if (!container) return;

    // 1. СТВОРЮЄМО ТРИ БАЗОВІ КАРТИ
    if (!drawnItems) drawnItems = new L.FeatureGroup();
    const googleSat = L.tileLayer('http://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
        maxZoom: 20, subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
    });
    // ТУТ МАГІЯ: Створюємо групу малювання ТІЛЬКИ якщо Leaflet вже завантажився
    if (typeof L !== 'undefined') {
        if (!drawnItems) drawnItems = new L.FeatureGroup();
    } else {
        console.error("Бібліотека карти ще не завантажилась!");
        return;
    }

    const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19, attribution: 'Tiles &copy; Esri'
    });

    const openStreetMap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap'
    });

    // 2. Ініціалізуємо карту з Esri за замовчуванням (вона найсвіжіша для полів)
    mapInstance = L.map('field-map', {
        center: [49.01, 33.64],
        zoom: 14,
        layers: [esriSat]
    });

    mapInstance.addLayer(drawnItems);

    // 3. СТВОРЮЄМО ЄДИНИЙ ПУЛЬТ КЕРУВАННЯ ШАРАМИ
    const baseMaps = {
        "🛰️ Esri Супутник (Свіжіший)": esriSat,
        "🛰️ Google Супутник": googleSat,
        "🗺️ Схема доріг (OSM)": openStreetMap
    };

    // Зберігаємо пульт глобально, щоб потім додавати туди фотографії Sentinel-2
    window.mapLayerControl = L.control.layers(baseMaps, null, { collapsed: false }).addTo(mapInstance);

    // Додаємо панель інструментів для малювання зліва
    const drawControl = new L.Control.Draw({
        draw: {
            polygon: {
                allowIntersection: false,
                drawError: { color: '#e1e100', message: 'Не можна перетинати лінії!' },
                shapeOptions: { color: '#10b981', fillOpacity: 0.4 }
            },
            polyline: false,
            circle: false,
            rectangle: false,
            marker: false,
            circlemarker: false
        },
        edit: {
            featureGroup: drawnItems,
            remove: true
        }
    });
    mapInstance.addControl(drawControl);

    // Що відбувається, коли ти закінчив обводити поле:
    mapInstance.on(L.Draw.Event.CREATED, function (event) {
        const layer = event.layer;
        drawnItems.clearLayers();
        drawnItems.addLayer(layer);

        const latlngs = layer.getLatLngs()[0];
        window.drawnPolygonCoords = latlngs.map(pt => [pt.lng, pt.lat]);

        const areaMeters = L.GeometryUtil.geodesicArea(latlngs);
        const areaHectares = (areaMeters / 10000).toFixed(2);
        window.drawnArea = areaHectares;

        const center = layer.getBounds().getCenter();
        window.lastClickedLat = center.lat;
        window.lastClickedLon = center.lng;

        alert(`Поле успішно обведено!\nАвтоматично розрахована площа: ${areaHectares} га.\nТепер натисніть кнопку "Додати" в посівну структуру.`);
    });

    // ЗБЕРЕЖЕННЯ ВІДРЕДАГОВАНИХ КОНТУРІВ
    mapInstance.on(L.Draw.Event.EDITED, function (e) {
        const layers = e.layers;
        layers.eachLayer(async function (layer) {
            const fieldId = layer.fieldId;
            if (!fieldId) return;

            // Рахуємо нові дані
            const latlngs = layer.getLatLngs()[0];
            const newCoords = latlngs.map(pt => [pt.lng, pt.lat]);
            const areaMeters = L.GeometryUtil.geodesicArea(latlngs);
            const newArea = (areaMeters / 10000).toFixed(2);

            // Знаходимо старе поле і підставляємо нові кордони
            const field = userFields.find(f => f.id === fieldId);
            const updatedData = {
                cadastre: field.cadastre,
                name: field.field,
                crop: field.crop,
                area: parseFloat(newArea),
                lat: layer.getBounds().getCenter().lat,
                lon: layer.getBounds().getCenter().lng,
                variety: field.variety,
                planting_date: field.planting_date,
                prev_crop: field.prev_crop,
                geometry: JSON.stringify(newCoords)
            };

            // Відправляємо на сервер
            try {
                await fetch(`https://agrilumen-demo.onrender.com/api/fields/${fieldId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatedData)
                });
                loadFieldsFromDB();
                alert(`Кордони поля оновлено! Нова площа: ${newArea} га`);
            } catch (err) {
                console.error("Помилка при збереженні контуру", err);
            }
        });
    });
}
// ==========================================
// 7. ПЕРЕКЛАД (UA/EN)
// ==========================================
function setLanguage(lang) {
    if (!window.translations || !window.translations[lang]) return;
    const dict = window.translations[lang];

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) {
            if (el.tagName === 'INPUT' && el.placeholder) {
                el.placeholder = dict[key];
            } else {
                el.innerText = dict[key];
            }
        }
    });
    localStorage.setItem('selectedLanguage', lang);
    updateFarmTableUI();

    const analyticsTab = document.getElementById('content-analytics');
    if (analyticsTab && !analyticsTab.classList.contains('hidden')) {
        calculateByDate();
    }
}

// МАЛЮЄМО ЗБЕРЕЖЕНІ ПОЛЯ НА КАРТІ
function displaySavedPolygons() {
    if (!mapInstance || !drawnItems) return;
    drawnItems.clearLayers();

    userFields.forEach(field => {
        if (field.geometry && field.geometry !== "null") {
            try {
                const coords = JSON.parse(field.geometry);
                // Leaflet очікує формат [lat, lon], тому перевертаємо
                const leafletCoords = coords.map(p => [p[1], p[0]]);

                const polygon = L.polygon(leafletCoords, {
                    color: '#10b981',
                    fillOpacity: 0.3
                }).addTo(drawnItems);

                // Прив'язуємо ID до фігури, щоб знати, що саме ми редагуємо
                polygon.fieldId = field.id;
                polygon.bindPopup(`<b>${field.field}</b>`);
            } catch (e) {
                console.error("Помилка малювання контуру:", e);
            }
        }
    });
}
// ==========================================
// 8. ЗАПУСК
// ==========================================
window.onload = () => {
    try {
        loadFieldsFromDB();
    } catch (e) { console.warn("Помилка БД:", e); }

    try {
        initDashboardChart();
    } catch (e) { console.warn("Помилка графіка:", e); }

    try {
        const savedLang = localStorage.getItem('selectedLanguage') || 'uk';
        setLanguage(savedLang);
    } catch (e) { console.warn("Помилка мови:", e); }
};
