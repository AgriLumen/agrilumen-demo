// ==========================================
// 1. КОНФІГУРАЦІЯ ТА ДАНІ
// ==========================================
const isLocal = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
const API_BASE_URL = isLocal ? "http://127.0.0.1:8000" : "https://agrilumen-demo.onrender.com";
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
        // ВИПРАВЛЕНО: замість локального хоста використовуємо універсальну змінну API_BASE_URL
        const response = await fetch(`${API_BASE_URL}/api/fields`);
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
            soil_type: f[11] || "Чорнозем"
        }));

        updateFarmTableUI();
        updateAnalyticsFieldSelector();
    } catch (error) {
        console.error("Помилка завантаження полів з БД:", error);
    }
}

function updateAnalyticsFieldSelector() {
    const select = document.getElementById('forecast-field-select');
    if (!select) return;

    const lang = localStorage.getItem('selectedLanguage') || 'uk';

    select.innerHTML = '';
    if (userFields.length === 0) {
        // Беремо переклад напряму зі словника!
        const text = window.translations[lang].first_add_field;
        select.innerHTML = `<option value="" data-i18n="first_add_field">${text}</option>`;
        return;
    }

    userFields.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id;

        const safeFieldName = f.field || f.name || "Поле";
        const translatedFieldName = String(safeFieldName).replace('Поле', window.translations[lang].th_field || 'Field');

        opt.innerHTML = `${translatedFieldName} (${f.area} ${window.translations[lang].unit_ha})`;
        select.appendChild(opt);
    });
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

    const lang = localStorage.getItem('selectedLanguage') || 'uk';
    const tr = (ua, en) => lang === 'en' ? en : ua;

    tbody.innerHTML = '';
    userFields.forEach(item => {
        // МАГІЧНИЙ ЗАПОБІЖНИК: беремо або field, або name, або дефолтне "Поле"
        const safeFieldName = item.field || item.name || "Поле";

        if (item.id === editingRowId) {
            tbody.innerHTML += `
                <tr class="bg-green-50/50 border-b">
                    <td class="px-3 py-3">
                        <input type="text" id="edit-name-${item.id}" value="${safeFieldName}" class="w-full p-1.5 text-sm border border-green-300 rounded shadow-sm focus:outline-none focus:ring-1 focus:ring-green-500">
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
                        <input type="number" step="0.01" id="edit-area-${item.id}" value="${item.area}" class="w-20 p-1.5 text-sm border border-green-300 rounded shadow-sm focus:outline-none"> <span data-i18n="unit_ha">${tr('га', 'ha')}</span>
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
        } else {
            const displayCrop = window.translations?.[lang]?.[item.crop] || item.crop;
            const displayVariety = item.variety === "Стандарт" ? tr('Стандарт', 'Standard') : (item.variety || '-');
            const displayPrev = item.prev_crop === "Невідомо" ? tr('Невідомо', 'Unknown') : (item.prev_crop || '-');

            // ТУТ БУЛА ПОМИЛКА: використовуємо safeFieldName, щоб не впав .replace()
            const translatedFieldName = String(safeFieldName).replace('Поле', tr('Поле', 'Field'));

            tbody.innerHTML += `
                <tr class="hover:bg-gray-50 transition-colors border-b">
                    <td class="px-5 py-4 font-bold text-green-700 underline cursor-pointer" onclick="focusFieldOnMap(${item.lat}, ${item.lon}, '${safeFieldName}')">${translatedFieldName}</td>
                    <td class="px-5 py-4"><span class="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-bold uppercase">${displayCrop}</span></td>
                    <td class="px-5 py-4 font-medium">${item.area} <span data-i18n="unit_ha">${tr('га', 'ha')}</span></td>
                    <td class="px-5 py-4 text-gray-600">${displayVariety}</td>
                    <td class="px-5 py-4 text-gray-600">${item.planting_date || '-'}</td>
                    <td class="px-5 py-4 text-gray-600">${displayPrev}</td>
                    <td class="px-5 py-4 text-gray-600" data-i18n="soil_chernozem">${tr('Чорнозем', 'Chernozem')}</td>
                    <td class="px-5 py-4 text-right">
                        <div class="flex justify-end gap-3">
                            <button onclick="startRowEdit(${item.id})" class="text-blue-500 hover:text-blue-700 transition-transform hover:scale-110" title="${tr('Редагувати', 'Edit')}"><i class="fa-solid fa-pen-to-square"></i></button>
                            <button onclick="removeField(${item.id})" class="text-rose-400 hover:text-rose-600 transition-transform hover:scale-110" title="${tr('Видалити', 'Delete')}"><i class="fa-solid fa-trash-can"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        }
    });
    const totalArea = userFields.reduce((sum, field) => sum + parseFloat(field.area || 0), 0);
    const totalAreaEl = document.getElementById('total-farm-area');
    if (totalAreaEl) totalAreaEl.innerHTML = `${totalArea.toFixed(2)} <span data-i18n="unit_ha">${tr('га', 'ha')}</span>`;
}


function addNewField() {
    const lang = localStorage.getItem('selectedLanguage') || 'uk';
    const tr = (ua, en) => lang === 'en' ? en : ua;

    if (!window.drawnPolygonCoords) {
        alert(tr("Будь ласка, спочатку обведіть поле на карті!", "Please outline the field on the map first!"));
        return;
    }

    document.getElementById('modal-field-name').value = tr(`Поле №${userFields.length + 1}`, `Field #${userFields.length + 1}`);
    document.getElementById('modal-field-crop').value = 'wheat';

    // Жорстко задаємо дефолтні значення, щоб вони співпадали з <option value="...">
    document.getElementById('modal-field-variety').value = 'Стандарт';
    document.getElementById('modal-field-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('modal-field-prev').value = 'Невідомо';

    document.getElementById('custom-field-modal').classList.remove('hidden');
}

function closeFieldModal() {
    document.getElementById('custom-field-modal').classList.add('hidden');
}

async function saveCustomField() {
    const lang = localStorage.getItem('selectedLanguage') || 'uk';
    const tr = (ua, en) => lang === 'en' ? en : ua;

    const fieldName = document.getElementById('modal-field-name').value;
    const finalCrop = document.getElementById('modal-field-crop').value;
    const finalVariety = document.getElementById('modal-field-variety').value || tr("Стандарт", "Standard");
    const finalDate = document.getElementById('modal-field-date').value || new Date().toISOString().split('T')[0];
    const finalPrev = document.getElementById('modal-field-prev').value || tr("Невідомо", "Unknown");

    if (!fieldName.trim()) {
        alert(tr("Введіть назву поля!", "Enter field name!"));
        return;
    }

    const payload = {
        user_id: 1,
        name: fieldName,
        field: fieldName,
        crop: finalCrop,
        area: window.drawnAreaHa ? parseFloat(window.drawnAreaHa.toFixed(2)) : 10.0,
        variety: finalVariety,
        planting_date: finalDate,
        prev_crop: finalPrev,
        lat: window.drawnCenterLat ? parseFloat(window.drawnCenterLat) : 48.0,
        lon: window.drawnCenterLon ? parseFloat(window.drawnCenterLon) : 33.0,
        geometry: window.drawnPolygonCoords ? JSON.stringify(window.drawnPolygonCoords) : "[]",
        cadastre: "",
        soil_type: "Чорнозем"
    };

    try {
        const response = await fetch(`${API_BASE_URL}/api/fields`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            // ГОЛОВНЕ ВИПРАВЛЕННЯ: Просто перезавантажуємо таблицю чистими даними прямо з бази!
            await loadFieldsFromDB();

            if (window.analyticsMapInstance && window.drawnPolygonLayer) {
                window.analyticsMapInstance.removeLayer(window.drawnPolygonLayer);
                window.drawnPolygonLayer = null;
                window.drawnPolygonCoords = null;
            }

            closeFieldModal();
            alert(tr("Поле успішно збережено!", "Field saved successfully!"));
        } else {
            const err = await response.json();
            alert(tr("Сервер відхилив дані. Перевірте форму.", "Server rejected data. Check form."));
        }
    } catch (e) {
        console.error(e);
        alert(tr("Помилка з'єднання з сервером.", "Server connection error."));
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

        // Шукай це приблизно в кінці функції saveRowEdit
        const response = await fetch(`${API_BASE_URL}/api/fields/${fieldId}`, {
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
        // ВИПРАВЛЕНО: використовуємо ${id} замість ${fieldId}
        const response = await fetch(`${API_BASE_URL}/api/fields/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            await loadFieldsFromDB(); // Перезавантажуємо чисті дані з бази
            alert("Поле видалено назавжди.");
        } else {
            const errText = await response.text();
            alert(`Помилка сервера при видаленні:\n${errText}`);
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
    const lang = localStorage.getItem('selectedLanguage') || 'uk';
    const tr = (ua, en) => lang === 'en' ? en : ua;

    const dateVal = document.getElementById('forecast-date').value;
    const cropKey = document.getElementById('forecast-crop').value;
    const select = document.getElementById('forecast-field-select');

    // БЕЗПЕЧНЕ ЗЧИТУВАННЯ ID
    const fieldId = select.value;

    if (!fieldId || fieldId === "undefined") {
        alert(tr("Спочатку виберіть або додайте поле!", "First, select or add a field!"));
        return;
    }

    const lossEl = document.getElementById('display-loss');
    if (lossEl) lossEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${tr("Аналізуємо космос...", "Analyzing space...")}`;

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
    updateProgress(5, tr("Ініціалізація запиту до бази даних...", "Initializing database query..."));

    let fakeProgress = setTimeout(() => updateProgress(25, tr("Отримання радарних даних (Sentinel-1)...", "Fetching radar data (Sentinel-1)...")), 1500);
    let fakeProgress2 = setTimeout(() => updateProgress(45, tr("Розрахунок індексу вологи та температури...", "Calculating moisture and temp indices...")), 3500);
    let fakeProgress3 = setTimeout(() => updateProgress(60, tr("Завантаження мультиспектральних знімків...", "Loading multispectral imagery...")), 6000);

    try {
        // 1. ВИПРАВЛЕНО НА ХМАРНИЙ СЕРВЕР
        const response = await fetch(`${API_BASE_URL}/api/analyze/${fieldId}?date_start=${dateVal}&date_end=${dateVal}`);

        clearTimeout(fakeProgress); clearTimeout(fakeProgress2); clearTimeout(fakeProgress3);
        updateProgress(75, tr("Дані отримано! Моделювання кліматичних ризиків...", "Data received! Modeling climate risks..."));

        const realData = await response.json();

        if (realData.error) {
            if (loader) { loader.classList.add('hidden'); loader.classList.remove('flex'); }
            alert(tr("Помилка супутника: ", "Satellite error: ") + realData.error);
            if (lossEl) lossEl.innerText = tr("Помилка", "Error");
            return;
        }

        const currentField = userFields.find(f => String(f.id) === String(fieldId));
        const area = currentField ? currentField.area : 100;
        const fieldLat = currentField ? currentField.lat : 49.0;
        const fieldLon = currentField ? currentField.lon : 33.0;

        let airTemp = realData.temp;
        let airPrecip = realData.precip || 0.0;

        try {
            const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${fieldLat}&longitude=${fieldLon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&start_date=${dateVal}&end_date=${dateVal}&timezone=auto`;
            const meteoResp = await fetch(meteoUrl);
            if (meteoResp.ok) {
                const meteoData = await meteoResp.json();
                if (meteoData && meteoData.daily && meteoData.daily.temperature_2m_max.length > 0) {
                    const tMax = meteoData.daily.temperature_2m_max[0];
                    const tMin = meteoData.daily.temperature_2m_min[0];
                    airTemp = (tMax + tMin) / 2;
                    airPrecip = meteoData.daily.precipitation_sum[0] ?? 0.0;
                }
            }
        } catch (e) {
            console.warn("Open-Meteo API не відповідає, використовуємо супутникову погоду", e);
        }

        const satTemp = realData.temp;
        const moisture = realData.moisture || 0;
        const surfMoist = realData.moisture_surface || 0;
        const rootMoist = realData.moisture_root || 0;

        const s2 = realData.satellites.sentinel2;
        const landsat = realData.satellites.landsat;
        const modis = realData.satellites.modis;

        let bestSat = null;
        let warningHtml = "";

        if (s2.raw !== null && s2.age <= 14) {
            bestSat = { ...s2, name: 'Sentinel-2 (10m)', badge: tr('Найвища точність', 'Highest Accuracy'), color: 'text-emerald-600' };
        } else if (landsat.raw !== null && landsat.age <= 14) {
            bestSat = { ...landsat, name: 'Landsat 8/9 (30m)', badge: tr('Середня точність', 'Medium Accuracy'), color: 'text-blue-600' };
        } else {
            let candidates = [];
            if (s2.raw !== null) candidates.push({ ...s2, name: 'Sentinel-2 (10m)' });
            if (landsat.raw !== null) candidates.push({ ...landsat, name: 'Landsat 8/9 (30m)' });
            if (modis.raw !== null) candidates.push({ ...modis, name: 'MODIS (250m)' });

            if (candidates.length > 0) {
                let oldestBest = candidates.reduce((prev, curr) => prev.age < curr.age ? prev : curr);
                bestSat = { ...oldestBest, badge: tr('Низька точність', 'Low Accuracy'), color: 'text-rose-600' };
                warningHtml = `
                    <div class="mt-2 p-2 bg-rose-50 border border-rose-200 rounded text-[9px] text-rose-700 leading-tight">
                        <i class="fa-solid fa-triangle-exclamation"></i> <strong>${tr("Увага:", "Warning:")}</strong> ${tr(`Тривала хмарність. Використано глибокий Nowcast (${bestSat.age} дн).`, `Extended cloud cover. Deep Nowcast used (${bestSat.age} d).`)}
                    </div>
                `;
            } else {
                bestSat = { raw: null, synth: (moisture < 35 ? 0.3 : 0.6), age: 0, name: tr('Радарний бекап', 'Radar Backup'), badge: tr('Критично', 'Critical'), color: 'text-gray-500' };
            }
        }

        let finalNdviToUse = bestSat.synth;

        const selectedDateObj = new Date(dateVal);
        const month = selectedDateObj.getMonth() + 1;
        const isWinter = [12, 1, 2, 3].includes(month);

        if (finalNdviToUse < 0.15 && !isWinter) {
            if (loader) { loader.classList.add('hidden'); loader.classList.remove('flex'); }
            if (lossEl) lossEl.innerText = tr("Нецільова ділянка", "Non-target area");
            alert(`🛰️ ${tr("Розрахунковий NDVI", "Calculated NDVI")} = ${finalNdviToUse.toFixed(2)}. ${tr("Показник занадто низький для вегетації!", "Value too low for vegetation!")}`);
            return;
        }

        updateProgress(85, tr("Генерація фінансових сценаріїв...", "Generating financial scenarios..."));
        const crop = AGRI_MODEL.crops[cropKey] || AGRI_MODEL.crops['wheat'];
        const targetMonth = new Date(dateVal).getMonth() + 1;

        const scenarioPayload = {
            crop: cropKey,
            area: parseFloat(area),
            price: crop.price,
            current_temp: satTemp,
            current_moisture: moisture,
            current_ndvi: finalNdviToUse,
            month: targetMonth
        };

        const wrapper = document.getElementById('scenarios-wrapper');
        if (wrapper) wrapper.classList.remove('hidden');

        const realRevEl = document.getElementById('real-rev');
        if (realRevEl) realRevEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

        const oldLossBlock = document.getElementById('display-loss');
        if (oldLossBlock) oldLossBlock.parentElement.classList.add('hidden');

        try {
            // 2. ВИПРАВЛЕНО НА ХМАРНИЙ СЕРВЕР
            const scenResp = await fetch(`${API_BASE_URL}/api/forecast_scenarios`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(scenarioPayload)
            });

            if (scenResp.ok) {
                const scenData = await scenResp.json();

                if (!scenData || !scenData.scenarios) throw new Error("Backend returned invalid scenario data");

                const unitY = tr('т/га', 't/ha');
                const unitM = tr('грн', 'UAH');

                const optY = document.getElementById('opt-yield');
                const optR = document.getElementById('opt-rev');
                if (optY) optY.innerText = scenData.scenarios.optimistic.yield.toFixed(1) + ' ' + unitY;
                if (optR) optR.innerText = scenData.scenarios.optimistic.revenue.toLocaleString('uk-UA') + ' ' + unitM;

                const realY = document.getElementById('real-yield');
                const realR = document.getElementById('real-rev');
                if (realY) realY.innerText = scenData.scenarios.realistic.yield.toFixed(1) + ' ' + unitY;
                if (realR) realR.innerText = scenData.scenarios.realistic.revenue.toLocaleString('uk-UA') + ' ' + unitM;

                const pesY = document.getElementById('pes-yield');
                const pesR = document.getElementById('pes-rev');
                if (pesY) pesY.innerText = scenData.scenarios.pessimistic.yield.toFixed(1) + ' ' + unitY;
                if (pesR) pesR.innerText = scenData.scenarios.pessimistic.revenue.toLocaleString('uk-UA') + ' ' + unitM;

                const realRiskValue = scenData.scenarios.realistic.loss_percent / 100;
                renderRiskChart(realRiskValue, 'none');
            } else {
                throw new Error("HTTP error " + scenResp.status);
            }
        } catch (e) {
            console.error("Не вдалося завантажити сценарний прогноз", e);
            if (realRevEl) realRevEl.innerText = tr("Помилка сервера", "Server error");
        }

        updateProgress(95, tr("Рендеринг теплової мапи...", "Rendering heat map..."));
        const weatherDescEl = document.getElementById('model-weather-desc');
        if (weatherDescEl) weatherDescEl.innerHTML = `<i class="fa-solid fa-temperature-half"></i> ${tr('Повітря', 'Air')}: ${airTemp.toFixed(1)}°C | <i class="fa-solid fa-cloud-rain"></i> ${tr('Опади', 'Precip')}: ${airPrecip} мм`;

        const rawDataPanel = document.getElementById('satellite-raw-data');
        if (rawDataPanel) rawDataPanel.classList.remove('hidden');

        const ndviEl = document.getElementById('raw-ndvi-val');
        if (ndviEl) {
            ndviEl.innerHTML = `
                <div class="flex justify-between items-center mb-1 mt-1">
                    <span class="text-[11px] text-gray-700 font-bold">${bestSat.name}</span>
                    <span class="text-[9px] px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">${bestSat.badge}</span>
                </div>
                <div class="flex items-end gap-2">
                    <span class="${bestSat.color} font-black text-2xl">${finalNdviToUse.toFixed(3)}</span>
                    <span class="text-[10px] text-gray-500 pb-1">${bestSat.age > 2 ? `Nowcast (${bestSat.age} ${tr('дн', 'd')})` : tr('Свіжий знімок', 'Fresh capture')}</span>
                </div>
                ${warningHtml}
            `;
        }

        const tempEl = document.getElementById('raw-temp-val');
        if (tempEl) {
            let tempStatus = `<span class="text-emerald-600 font-bold text-[10px] uppercase">${tr('Оптимально', 'Optimal')}</span>`;
            if (satTemp < crop.tCrit) tempStatus = `<span class="text-blue-600 font-bold text-[10px] uppercase">${tr('Стрес (Холод)', 'Stress (Cold)')}</span>`;
            if (satTemp > crop.tMax) tempStatus = `<span class="text-rose-600 font-bold text-[10px] uppercase">${tr('Стрес (Спека)', 'Stress (Heat)')}</span>`;

            tempEl.innerHTML = `
                <div class="flex justify-between border-b border-gray-100 pb-1 mb-1 mt-1">
                    <span class="text-[11px] text-gray-700 font-medium">${tr('Повітря (Синоптик)', 'Air (Synoptic)')}</span>
                    <span class="text-slate-800 font-bold text-sm">${airTemp.toFixed(1)}°C</span>
                </div>
                <div class="flex justify-between border-b border-gray-100 pb-1 mb-1">
                    <span class="text-[11px] text-gray-700 font-medium">${tr('Поле (Супутник)', 'Field (Satellite)')}</span>
                    <span class="text-rose-600 font-bold text-sm">${satTemp.toFixed(1)}°C</span>
                </div>
                <div class="flex justify-between items-center mt-1">
                    <span class="text-[11px] text-gray-700 font-bold">${tr('Стан рослини', 'Plant Status')}</span>
                    ${tempStatus}
                </div>
            `;
        }

        const moistureEl = document.getElementById('raw-moisture-val');
        if (moistureEl) {
            moistureEl.innerHTML = `
                <div class="flex justify-between border-b border-gray-100 pb-1 mb-1 mt-1">
                    <span class="text-[11px] text-gray-700 font-medium italic">${tr('Радар (Поверхня)', 'Radar (Surface)')}</span>
                    <span class="text-blue-600 font-bold">${surfMoist.toFixed(1)}%</span>
                </div>
                <div class="flex justify-between border-b border-gray-100 pb-1 mb-1">
                    <span class="text-[11px] text-gray-700 font-medium italic">${tr('NASA (Коріння)', 'NASA (Root)')}</span>
                    <span class="text-emerald-600 font-bold">${rootMoist.toFixed(1)}%</span>
                </div>
                <div class="flex justify-between mt-1">
                    <span class="text-[11px] text-gray-700 font-bold">${tr('Розрахункова база', 'Calculated Base')}</span>
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
                // ЗАПИТ КАРТИ НА СЕРВЕР
                const tileResp = await fetch(`${API_BASE_URL}/api/map_layers/${fieldId}?target_date=${dateVal}`);
                const tileData = await tileResp.json();

                // ЯКЩО СЕРВЕР УСПІШНО ВІДДАВ ЛІНКИ НА КАРТИНКИ - МАЛЮЄМО МЕНЮ
                if (tileData.status === "success") {
                    const overlayMaps = {};
                    if (tileData.ndvi_url) {
                        window.satelliteNdviLayer = L.tileLayer(tileData.ndvi_url, { opacity: 0.9, zIndex: 10 }).addTo(window.analyticsMapInstance);
                        overlayMaps[tr("🌡️ Теплова мапа", "🌡️ Heat Map") + " (" + tileData.sat_name + ")"] = window.satelliteNdviLayer;
                    }
                    if (tileData.rgb_url) {
                        window.satelliteRgbLayer = L.tileLayer(tileData.rgb_url, { opacity: 1.0, zIndex: 10 });
                        overlayMaps[tr("📸 Реальне фото (RGB)", "📸 Real Photo (RGB)")] = window.satelliteRgbLayer;
                    }
                    if (tileData.radar_url) {
                        window.satelliteRadarLayer = L.tileLayer(tileData.radar_url, { opacity: 1.0, zIndex: 11 });
                        overlayMaps[tr("📡 Радар (Волога)", "📡 Radar (Moisture)")] = window.satelliteRadarLayer;
                    }
                    window.analyticsLayerControl = L.control.layers(null, overlayMaps, { collapsed: false }).addTo(window.analyticsMapInstance);
                }
            } catch (e) {
                console.error("Не вдалося завантажити фото шари:", e);
            }
        }
        updateProgress(100, tr("Готово!", "Done!"));
        setTimeout(() => {
            if (loader) { loader.classList.add('hidden'); loader.classList.remove('flex'); }
        }, 600);

    } catch (error) {
        console.error("Помилка розрахунку:", error);
        if (loader) { loader.classList.add('hidden'); loader.classList.remove('flex'); }
        if (lossEl) lossEl.innerText = tr("Помилка з'єднання", "Connection Error");
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
        let coords = latlngs.map(pt => [pt.lng, pt.lat]);

        // ГЕОПРОСТОРОВИЙ ФІКС: GeoJSON та Earth Engine вимагають замкнутого контуру
        if (coords.length > 0) {
            const firstPt = coords[0];
            const lastPt = coords[coords.length - 1];
            // Якщо перша і остання точка не збігаються - дублюємо першу в кінець
            if (firstPt[0] !== lastPt[0] || firstPt[1] !== lastPt[1]) {
                coords.push([...firstPt]);
            }
        }
        window.drawnPolygonCoords = coords;

        const areaMeters = L.GeometryUtil.geodesicArea(latlngs);
        const areaHectares = (areaMeters / 10000).toFixed(2);
        window.drawnAreaHa = parseFloat(areaHectares);

        const center = layer.getBounds().getCenter();
        window.drawnCenterLat = center.lat;
        window.drawnCenterLon = center.lng;

        alert(`Поле успішно обведено!\nАвтоматично розрахована площа: ${areaHectares} га.\nТепер натисніть зелену кнопку "Додати".`);
    });

    // ЗБЕРЕЖЕННЯ ВІДРЕДАГОВАНИХ КОНТУРІВ
    mapInstance.on(L.Draw.Event.EDITED, function (e) {
        const layers = e.layers;
        layers.eachLayer(async function (layer) {
            const fieldId = layer.fieldId;
            if (!fieldId) return;

            const latlngs = layer.getLatLngs()[0];
            let newCoords = latlngs.map(pt => [pt.lng, pt.lat]);

            // ГЕОПРОСТОРОВИЙ ФІКС ДЛЯ РЕДАГУВАННЯ
            if (newCoords.length > 0) {
                const firstPt = newCoords[0];
                const lastPt = newCoords[newCoords.length - 1];
                if (firstPt[0] !== lastPt[0] || firstPt[1] !== lastPt[1]) {
                    newCoords.push([...firstPt]);
                }
            }

            const areaMeters = L.GeometryUtil.geodesicArea(latlngs);
            const newArea = (areaMeters / 10000).toFixed(2);

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

            try {
                await fetch(`${API_BASE_URL}/api/fields/${fieldId}`, {
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

    localStorage.setItem('selectedLanguage', lang);

    // ЗМІНЮЄМО МОВУ САМОГО ДОКУМЕНТА (щоб календар браузера адаптувався)
    document.documentElement.lang = lang === 'uk' ? 'uk' : 'en';

    // Оновлюємо динамічні таблиці та списки
    updateFarmTableUI();
    updateAnalyticsFieldSelector();

    // Перекладаємо весь статичний текст
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
// ==========================================
// 8. ЗАПУСК
// ==========================================
window.onload = () => {
    // Спочатку виконуємо всі критичні запити
    try { loadFieldsFromDB(); } catch (e) { console.warn("Помилка БД:", e); }
    try { initDashboardChart(); } catch (e) { console.warn("Помилка графіка:", e); }

    // Налаштовуємо всі UI елементи сторінки (дефолт - сьогодні)
    const today = new Date().toISOString().split('T')[0];

    const forecastDateInput = document.getElementById('forecast-date');
    if (forecastDateInput) forecastDateInput.value = today;

    const modalDateInput = document.getElementById('modal-field-date');
    if (modalDateInput) modalDateInput.value = today;

    try {
        const savedLang = localStorage.getItem('selectedLanguage') || 'uk';
        setLanguage(savedLang);
    } catch (e) { console.warn("Помилка мови:", e); }

    // --- МАГІЯ АВТОПІДСТАНОВКИ ДАТИ ---
    const fieldSelect = document.getElementById('forecast-field-select');
    if (fieldSelect && forecastDateInput) {
        fieldSelect.addEventListener('change', function () {
            const fieldId = this.value;
            if (!fieldId) return;

            // Знаходимо обране поле у нашій базі
            const currentField = userFields.find(f => String(f.id) === String(fieldId));

            // Якщо у поля є нормальна дата посіву - ставимо її
            if (currentField && currentField.planting_date && currentField.planting_date !== 'Не вказано' && currentField.planting_date !== 'undefined') {
                forecastDateInput.value = currentField.planting_date;
            } else {
                // Якщо дати посіву немає (наприклад, старе тестове поле) - повертаємо сьогоднішню
                forecastDateInput.value = today;
            }
        });
    }
};
