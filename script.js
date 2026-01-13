// --- CONFIGURATION ---
const URL_MODEL = "https://teachablemachine.withgoogle.com/models/2KNvF2Sda/";

const firebaseConfig = {
  apiKey: "AIzaSyDgFj6bpL_rrzdnv5LcoeXd-VTYWyhahDk",
  authDomain: "recon-database-2f0c1.firebaseapp.com",
  projectId: "recon-database-2f0c1",
  storageBucket: "recon-database-2f0c1.firebasestorage.app",
  messagingSenderId: "331060784794",
  appId: "1:331060784794:web:a39ae38a64806eadea3923",
  measurementId: "G-MLVBC1WPLY"
};

// --- INIT ---
try {
    firebase.initializeApp(firebaseConfig);
    console.log("Uplink Established.");
} catch (e) { console.warn("Offline Mode"); }

// MAP SETUP - FLORIDA CENTER
const map = L.map('map', { 
    zoomControl: false, 
    attributionControl: false 
}).setView([27.6648, -81.5158], 7); // <-- CHANGED TO FLORIDA, ZOOM 7

// SATELLITE TILES
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, crossOrigin: true
}).addTo(map);

// DISPLAY COORDINATES
map.on('move', () => {
    const c = map.getCenter();
    document.getElementById('lat-disp').innerText = c.lat.toFixed(5);
    document.getElementById('lng-disp').innerText = c.lng.toFixed(5);
});

// --- AI LOADER ---
let model;
async function loadAI() {
    try {
        model = await tmImage.load(URL_MODEL + "model.json", URL_MODEL + "metadata.json");
        document.getElementById("scan-readout").innerText = "SYSTEM READY";
    } catch (e) { console.error(e); }
}
loadAI();

// --- MATH HELPERS ---
function latLngToTile(lat, lng, zoom) {
    const n = Math.pow(2, zoom);
    const x = Math.floor((lng + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x, y };
}

function tileToLatLng(x, y, zoom) {
    const n = Math.pow(2, zoom);
    const lng = x / n * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
    const lat = latRad * 180 / Math.PI;
    return { lat, lng };
}

// --- DRAG SELECTION LOGIC ---
let isTargeting = false;
let startX, startY;
const box = document.getElementById('selection-box');
const mapContainer = document.getElementById('map');
let isScanning = false;

window.toggleMode = function() {
    isTargeting = !isTargeting;
    const btn = document.getElementById('mode-btn');
    const instr = document.getElementById('instruction-text');
    
    if (isTargeting) {
        btn.innerText = "DISENGAGE TARGETING";
        btn.classList.add("active");
        instr.style.display = "block";
        map.dragging.disable(); 
        mapContainer.style.cursor = "crosshair";
    } else {
        btn.innerText = "ACTIVATE TURBO SCAN";
        btn.classList.remove("active");
        instr.style.display = "none";
        map.dragging.enable(); 
        mapContainer.style.cursor = "grab";
        box.style.display = 'none';
    }
};

mapContainer.addEventListener('mousedown', startDraw);
mapContainer.addEventListener('touchstart', (e) => startDraw(e.touches[0]), {passive: false});
mapContainer.addEventListener('mousemove', moveDraw);
mapContainer.addEventListener('touchmove', (e) => moveDraw(e.touches[0]), {passive: false});
mapContainer.addEventListener('mouseup', endDraw);
mapContainer.addEventListener('touchend', endDraw);

function startDraw(e) {
    if (!isTargeting) return;
    const rect = mapContainer.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    box.style.left = startX + 'px';
    box.style.top = startY + 'px';
    box.style.width = '0px';
    box.style.height = '0px';
    box.style.display = 'block';
}

function moveDraw(e) {
    if (!isTargeting || box.style.display === 'none') return;
    const rect = mapContainer.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;
    box.style.width = Math.abs(currentX - startX) + 'px';
    box.style.height = Math.abs(currentY - startY) + 'px';
    box.style.left = (currentX < startX ? currentX : startX) + 'px';
    box.style.top = (currentY < startY ? currentY : startY) + 'px';
}

function endDraw() {
    if (!isTargeting) return;
    const rect = box.getBoundingClientRect();
    if (rect.width > 20 && rect.height > 20) {
        const p1 = map.containerPointToLatLng([rect.left, rect.top]);
        const p2 = map.containerPointToLatLng([rect.right, rect.bottom]);
        
        const north = Math.max(p1.lat, p2.lat);
        const south = Math.min(p1.lat, p2.lat);
        const west = Math.min(p1.lng, p2.lng);
        const east = Math.max(p1.lng, p2.lng);

        startTurboScan(north, south, west, east);
    }
    box.style.display = 'none';
}

// --- TURBO SCANNER ---
window.cancelScan = function() {
    isScanning = false;
    document.getElementById('progress-overlay').style.display = 'none';
};

async function startTurboScan(north, south, west, east) {
    if (!model) return;
    isScanning = true;
    
    const overlay = document.getElementById('progress-overlay');
    const bar = document.getElementById('progress-fill');
    const txt = document.getElementById('progress-text');
    overlay.style.display = 'flex';
    txt.innerText = "CALCULATING GRID...";

    const ZOOM = 19;
    const tl = latLngToTile(north, west, ZOOM);
    const br = latLngToTile(south, east, ZOOM);
    
    let tiles = [];
    for (let x = tl.x; x <= br.x; x++) {
        for (let y = tl.y; y <= br.y; y++) {
            tiles.push({ x: x, y: y });
        }
    }

    if (tiles.length > 500) {
        if(!confirm(`Warning: This selection contains ${tiles.length} sectors. Continue?`)) {
            cancelScan();
            return;
        }
    }

    const total = tiles.length;
    let processed = 0;
    let found = 0;

    for (let i = 0; i < total; i++) {
        if (!isScanning) break;

        const tile = tiles[i];
        const imgUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${ZOOM}/${tile.y}/${tile.x}`;
        
        try {
            const isAbandoned = await scanImage(imgUrl);
            
            if (isAbandoned) {
                found++;
                const coords = tileToLatLng(tile.x + 0.5, tile.y + 0.5, ZOOM);
                saveTarget(isAbandoned, imgUrl, coords);
            }
        } catch (e) {}

        processed++;
        const pct = Math.round((processed / total) * 100);
        bar.style.width = pct + "%";
        txt.innerText = `SCANNING... ${pct}% (${found} FOUND)`;
        
        if (i % 5 === 0) await new Promise(r => setTimeout(r, 10));
    }

    if(isScanning) {
        txt.innerText = "DONE.";
        setTimeout(() => { overlay.style.display = 'none'; }, 2000);
    }
}

function scanImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "Anonymous"; 
        img.src = url;
        img.onload = async () => {
            const prediction = await model.predict(img);
            const abandon = prediction.find(p => p.className === "Abandoned");
            if (abandon && abandon.probability > 0.75) {
                resolve(abandon.probability);
            } else {
                resolve(false);
            }
        };
        img.onerror = () => resolve(false);
    });
}

// --- DATABASE ---
function saveTarget(confidence, imgUrl, latlng) {
    const locId = Date.now() + Math.random().toString(36).substr(2, 5);
    firebase.database().ref('discovery/' + locId).set({
        lat: latlng.lat,
        lng: latlng.lng,
        confidence: confidence,
        image: imgUrl,
        timestamp: Date.now()
    });
}

window.toggleDatabase = function() {
    const el = document.getElementById('database-overlay');
    const grid = document.getElementById('db-grid');
    if (el.style.display === 'none') {
        el.style.display = 'flex';
        grid.innerHTML = '<div style="color:#0f0;">LOADING ARCHIVES...</div>';
        firebase.database().ref('discovery/').once('value', (snapshot) => {
            grid.innerHTML = '';
            const data = snapshot.val();
            if (data) {
                Object.keys(data).reverse().forEach(key => {
                    const item = data[key];
                    const div = document.createElement('div');
                    div.className = 'db-item';
                    const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng}`;
                    div.innerHTML = `
                        <img src="${item.image}" />
                        <div class="db-info">
                            CONF: ${(item.confidence*100).toFixed(0)}%
                        </div>
                        <a href="${gmapsUrl}" target="_blank" class="coord-link">OPEN MAPS</a>
                    `;
                    grid.appendChild(div);
                });
            } else { grid.innerHTML = 'NO TARGETS FOUND'; }
        });
    } else { el.style.display = 'none'; }
};
