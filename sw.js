const CACHE = 'jha-adc-v1';
const ASSETS = [
  '/login.html',
  '/jha-form.html',
  '/jha-dashboard.html',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

// Install — cache assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => {
      return cache.addAll(['/login.html', '/jha-form.html', '/jha-dashboard.html']);
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first, fallback to cache
self.addEventListener('fetch', e => {
  // Skip non-GET and Supabase API calls (always need network)
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('supabase.co')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Cache successful responses
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() => {
        // Offline fallback
        return caches.match(e.request).then(cached => {
          if (cached) return cached;
          // If HTML page not found, show login
          if (e.request.destination === 'document') {
            return caches.match('/login.html');
          }
        });
      })
  );
});

// Background sync — retry failed submissions when back online
self.addEventListener('sync', e => {
  if (e.tag === 'jha-sync') {
    e.waitUntil(syncPendingForms());
  }
});

async function syncPendingForms() {
  // Forms saved offline will be sent when connection returns
  const db = await openDB();
  const pending = await db.getAll('pending');
  for (const form of pending) {
    try {
      const res = await fetch('https://klvxppajwtwxxeomvefe.supabase.co/rest/v1/jha_submissions', {
        method: 'POST',
        headers: {
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtsdnhwcGFqd3R3eHhlb212ZWZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4OTM0NTgsImV4cCI6MjA5MzQ2OTQ1OH0.QApeuRya7HiOT494qljVIKTv7XX_HSeS61tAwijbOlk',
          'Authorization': 'Bearer ' + form.token,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(form.payload)
      });
      if (res.ok) await db.delete('pending', form.id);
    } catch(e) {}
  }
}

// Simple IndexedDB helper for offline queue
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('jha-offline', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('pending', {keyPath:'id', autoIncrement:true});
    req.onsuccess = e => {
      const db = e.target.result;
      resolve({
        getAll: store => new Promise((res,rej) => {const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=rej;}),
        delete: (store,id) => new Promise((res,rej) => {const r=db.transaction(store,'readwrite').objectStore(store).delete(id);r.onsuccess=res;r.onerror=rej;})
      });
    };
    req.onerror = reject;
  });
}
