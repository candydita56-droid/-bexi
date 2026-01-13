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
const db = firebase.database();

const map = L.map('map', { 
    zoomControl: false, 
    attributionControl: false 
}).setView([42.3314, -83.0458], 18);

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, crossOrigin: true
}).addTo(map);

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

// --- DRAG SELECTION LOGIC ---
let isTargeting = false;
let startX, startY;
const box = document.getElementById('selection-box');
const mapContainer = document.getElementById('map');

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
        btn.innerText = "ACTIVATE TARGETING";
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
    
    const width = currentX - startX;
    const height = currentY - startY;
    
    box.style.width = Math.abs(width) + 'px';
    box.style.height = Math.abs(height) + 'px';
    box.style.left = (width < 0 ? currentX : startX) + 'px';
    box.style.top = (height < 0 ? currentY : startY) + 'px';
}

function endDraw() {
    if (!isTargeting) return;
    const rect = box.getBoundingClientRect();
    // Scan if box is big enough
    if (rect.width > 20 && rect.height > 20) {
        processGridScan(rect);
    }
    setTimeout(() => { box.style.display = 'none'; }, 200);
}

// --- DEEP GRID SCANNING ---
async function processGridScan(rect) {
    if (!model) return;
    
    const readout = document.getElementById("scan-readout");
    readout.innerText = "INITIATING GRID SCAN...";
    
    // 1. Capture the entire map view first (High Performance)
    const scale = window.devicePixelRatio || 2;
    const fullCanvas = await html2canvas(document.getElementById("map"), {
        useCORS: true, allowTaint: true, scale: scale
    });
    
    // 2. Define Grid Parameters
    // We break the red box into 100x100 pixel chunks to scan individually
    const scanSize = 100; // Size of the scanner window in CSS pixels
    const step = 80;      // Overlap slightly to catch buildings on edges
    
    // Adjust logic coordinates relative to the captured canvas
    // We need to map the CSS coordinates of the red box to the Canvas coordinates
    const mapRect = document.getElementById("map").getBoundingClientRect();
    
    // Red box relative to map container
    const startX = rect.left - mapRect.left;
    const startY = rect.top - mapRect.top;
    
    let targetsFound = 0;
    
    // 3. Loop through the red box (The "Deep Dig")
    for (let y = startY; y < startY + rect.height; y += step) {
        for (let x = startX; x < startX + rect.width; x += step) {
            
            // Safety check: Don't scan outside the box
            if (x + scanSize > startX + rect.width || y + scanSize > startY + rect.height) continue;

            // Crop this specific grid sector
            const sectorCanvas = document.createElement('canvas');
            sectorCanvas.width = scanSize * scale;
            sectorCanvas.height = scanSize * scale;
            const ctx = sectorCanvas.getContext('2d');
            
            ctx.drawImage(
                fullCanvas,
                x * scale, y * scale, scanSize * scale, scanSize * scale,
                0, 0, scanSize * scale, scanSize * scale
            );
            
            // Predict this sector
            const prediction = await model.predict(sectorCanvas);
            const abandoned = prediction.find(p => p.className === "Abandoned");
            
            if (abandoned && abandoned.probability > 0.80) { // Strict threshold
                targetsFound++;
                
                // Calculate Exact Real-World Lat/Lng of this sector center
                const centerX = x + (scanSize / 2);
                const centerY = y + (scanSize / 2);
                const latlng = map.containerPointToLatLng([centerX, centerY]);
                
                saveTarget(abandoned.probability, sectorCanvas.toDataURL(), latlng);
            }
        }
    }
    
    if (targetsFound > 0) {
        readout.innerText = `SCAN COMPLETE. ${targetsFound} TARGETS FOUND.`;
        document.getElementById("confidence-meter").style.width = "100%";
        document.getElementById("confidence-meter").style.backgroundColor = "#f00";
    } else {
        readout.innerText = "AREA CLEAR.";
        document.getElementById("confidence-meter").style.width = "0%";
    }
}

// --- DATABASE & GOOGLE MAPS LINK ---
function saveTarget(confidence, imgData, latlng) {
    const locId = Date.now() + Math.random().toString(36).substr(2, 5);
    
    firebase.database().ref('discovery/' + locId).set({
        lat: latlng.lat,
        lng: latlng.lng,
        confidence: confidence,
        image: imgData,
        timestamp: Date.now()
    });
}

window.toggleDatabase = function() {
    const el = document.getElementById('database-overlay');
    const grid = document.getElementById('db-grid');
    
    if (el.style.display === 'none') {
        el.style.display = 'flex';
        grid.innerHTML = '<div style="color:#0f0;">RETRIEVING INTEL...</div>';
        
        firebase.database().ref('discovery/').once('value', (snapshot) => {
            grid.innerHTML = '';
            const data = snapshot.val();
            if (data) {
                Object.keys(data).reverse().forEach(key => {
                    const item = data[key];
                    const div = document.createElement('div');
                    div.className = 'db-item';
                    
                    // Create Google Maps Link
                    const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng}`;
                    
                    div.innerHTML = `
                        <img src="${item.image}" />
                        <div class="db-info">
                            CONFIDENCE: ${(item.confidence*100).toFixed(0)}%<br>
                            LAT: ${item.lat.toFixed(5)}<br>
                            LNG: ${item.lng.toFixed(5)}
                        </div>
                        <a href="${gmapsUrl}" target="_blank" class="coord-link">OPEN IN GOOGLE MAPS</a>
                    `;
                    grid.appendChild(div);
                });
            } else {
                grid.innerHTML = '<div style="color:#555;">NO DISCOVERIES YET</div>';
            }
        });
    } else {
        el.style.display = 'none';
    }
};
