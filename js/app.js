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

let userFields = [
    { id: 1, field: "Поле №1", crop: "wheat", area: 120, variety: "Скаген", date: "2024-09-15", prev: "Ріпак" },
    { id: 2, field: "Поле №2", crop: "corn", area: 80, variety: "ДКС 3939", date: "2024-04-20", prev: "Пшениця" }
];

let charts = { dashboard: null, analytics: null };
let mapInstance = null;

// ==========================================
// 2. ДАШБОРД
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
// 3. МОЯ ФЕРМА (Керування таблицею)
// ==========================================
function updateFarmTableUI() {
    const tbody = document.getElementById('farm-table-body');
    if (!tbody) return;

    // Визначаємо поточну мову
    const lang = localStorage.getItem('selectedLanguage') || 'uk';
    const dict = window.translations[lang];

    tbody.innerHTML = '';
    userFields.forEach(item => {
        // Беремо назву культури зі словника перекладів
        const cropName = dict[item.crop] || item.crop;

        tbody.innerHTML += `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="px-5 py-4 font-medium text-gray-700">${item.field}</td>
                <td class="px-5 py-4"><span class="px-2 py-1 bg-green-50 text-green-700 rounded-md text-xs font-bold">${cropName}</span></td>
                <td class="px-5 py-4">${item.area} га</td>
                <td class="px-5 py-4 text-gray-500">${item.variety}</td>
                <td class="px-5 py-4 text-gray-500">${item.date}</td>
                <td class="px-5 py-4 text-gray-500">${item.prev}</td>
                <td class="px-5 py-4">
                    <button onclick="removeField(${item.id})" class="text-rose-500 hover:text-rose-700"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    });
}

function addNewField() {
    const fieldName = prompt("Введіть назву поля / Enter field name:", `Поле №${userFields.length + 1}`);
    if (!fieldName) return;

    userFields.push({
        id: Date.now(),
        field: fieldName,
        crop: "sunflower",
        area: 50,
        variety: "Стандарт",
        date: "2025-04-10",
        prev: "Пшениця"
    });
    updateFarmTableUI();
}

function removeField(id) {
    userFields = userFields.filter(f => f.id !== id);
    updateFarmTableUI();
}

// ==========================================
// 4. АНАЛІТИКА (Календар та Погода)
// ==========================================
function getMockWeather(dateString) {
    const date = new Date(dateString);
    const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
    const avgTemp = 12;
    const amplitude = 18;
    const baseTemp = avgTemp + amplitude * Math.sin((dayOfYear - 105) * 2 * Math.PI / 365);
    const randomNoise = (Math.random() * 8) - 4;
    return parseFloat((baseTemp + randomNoise).toFixed(1));
}

function calculateByDate() {
    const dateVal = document.getElementById('forecast-date').value;
    const cropKey = document.getElementById('forecast-crop').value;
    const temp = getMockWeather(dateVal);
    const crop = AGRI_MODEL.crops[cropKey];

    // Мова для динамічних повідомлень
    const lang = localStorage.getItem('selectedLanguage') || 'uk';
    const dict = window.translations[lang];

    let eventType = 'none', deltaT = 0, hours = 0;

    if (temp < crop.tCrit) {
        eventType = 'frost';
        deltaT = crop.tCrit - temp;
        hours = 12;
    } else if (temp > crop.tMax) {
        eventType = 'heat';
        deltaT = temp - crop.tMax;
        hours = 8;
    }

    const k = AGRI_MODEL.k_factors[eventType] || 0;
    const dose = deltaT * hours;
    const riskS = Math.min(1, k * dose);
    const lossPercent = (riskS * crop.lMax * 100).toFixed(2);

    const totalArea = userFields
        .filter(f => f.crop === cropKey)
        .reduce((sum, f) => sum + f.area, 0) || 100;

    const financialLoss = Math.round(totalArea * crop.yield * crop.price * (lossPercent / 100));

    // Оновлення тексту в Аналітиці (використовуємо переклади)
    const lossEl = document.getElementById('display-loss');
    if (lossEl) lossEl.innerText = `-${financialLoss.toLocaleString('uk-UA')} грн`;

    const probEl = document.querySelector('[data-i18n="risk_probability"]');
    if (probEl) {
        const tempLabel = lang === 'uk' ? 'Температура' : 'Temperature';
        const lossLabel = lang === 'uk' ? 'Втрати' : 'Losses';
        const areaLabel = lang === 'uk' ? 'для площі' : 'for area';
        probEl.innerHTML = `<strong>${tempLabel}: ${temp}°C</strong>. ${lossLabel}: ${lossPercent}% (${areaLabel} ${totalArea} га)`;
    }

    // Оновлення дерева параметрів
    const treeBlocks = document.querySelectorAll('#content-analytics .p-4 span');
    if (treeBlocks.length >= 2) {
        const weatherLabel = lang === 'uk' ? 'Температура: ' : 'Temperature: ';
        const doseLabel = lang === 'uk' ? 'Доза: ' : 'Dose: ';
        treeBlocks[0].innerText = weatherLabel + temp + "°C";
        treeBlocks[1].innerText = doseLabel + dose.toFixed(1);
    }

    renderRiskChart(k, eventType);
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

// ==========================================
// 5. НАВІГАЦІЯ
// ==========================================
function switchTab(tabId) {
    document.querySelectorAll('.content-tab').forEach(tab => tab.classList.add('hidden'));
    document.getElementById('tab-hero').classList.add('hidden');
    document.getElementById('platform-ui').classList.remove('hidden');

    const target = document.getElementById(`content-${tabId}`);
    if (target) target.classList.remove('hidden');

    document.querySelectorAll('.nav-link').forEach(btn => btn.classList.remove('active'));
    const btn = document.getElementById(`btn-${tabId}`);
    if (btn) btn.classList.add('active');

    if (tabId === 'dashboard') initDashboardChart();
    if (tabId === 'analytics') calculateByDate();
    if (tabId === 'myfarm') {
        updateFarmTableUI();
        setTimeout(initMapOnce, 200);
    }
}

function initMapOnce() {
    if (mapInstance) return;
    const container = document.getElementById('field-map');
    if (!container) return;
    mapInstance = L.map('field-map').setView([48.3794, 31.1656], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapInstance);
}

// ==========================================
// 6. ПЕРЕКЛАД (UA/EN)
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

    // ПЕРЕМАЛЬОВУЄМО ДИНАМІЧНІ ЕЛЕМЕНТИ ПРИ ЗМІНІ МОВИ
    updateFarmTableUI();

    // Якщо відкрита вкладка аналітики - оновлюємо і її
    const analyticsTab = document.getElementById('content-analytics');
    if (analyticsTab && !analyticsTab.classList.contains('hidden')) {
        calculateByDate();
    }
}

// ==========================================
// 7. ЗАПУСК
// ==========================================
window.onload = () => {
    initDashboardChart();
    const savedLang = localStorage.getItem('selectedLanguage') || 'uk';
    setLanguage(savedLang);
};
