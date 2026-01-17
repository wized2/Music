// Service Worker: Endroid Music - Dual Cache with Offline First Strategy
// Version: 2.0.0
// Date: 2024

// Cache Names - Using dual cache strategy
const CACHE_PRIMARY = 'endroid-music-primary-v2.1';
const CACHE_SECONDARY = 'endroid-music-secondary-v2.1';
const CACHE_DATA = 'endroid-music-data-v2.1';

// Critical assets that must be cached for offline use
const CRITICAL_ASSETS = [
  '/', // Index page
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  // Self-reference for resilience
  '/service-worker.js'
  'https://fonts.googleapis.com/icon?family=Material+Icons'
];

// Optional assets that can be cached but aren't critical
const OPTIONAL_ASSETS = [
  // Add any additional assets here if needed
];

// Installation - Cache critical assets in both primary and secondary caches
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  
  event.waitUntil(
    Promise.all([
      // Cache in primary storage
      caches.open(CACHE_PRIMARY).then(cache => {
        console.log('[Service Worker] Caching critical assets in primary cache');
        return cache.addAll(CRITICAL_ASSETS.map(url => new Request(url, { cache: 'reload' })));
      }).catch(err => {
        console.error('[Service Worker] Primary cache installation failed:', err);
        // Don't fail installation if primary cache fails
        return Promise.resolve();
      }),
      
      // Cache in secondary storage for redundancy
      caches.open(CACHE_SECONDARY).then(cache => {
        console.log('[Service Worker] Caching critical assets in secondary cache');
        return cache.addAll(CRITICAL_ASSETS.map(url => new Request(url, { cache: 'reload' })));
      }).catch(err => {
        console.error('[Service Worker] Secondary cache installation failed:', err);
        // Don't fail installation if secondary cache fails
        return Promise.resolve();
      }),
      
      // Cache optional assets in data cache
      caches.open(CACHE_DATA).then(cache => {
        console.log('[Service Worker] Caching optional assets in data cache');
        return cache.addAll(OPTIONAL_ASSETS);
      }).catch(err => {
        console.error('[Service Worker] Data cache installation failed:', err);
        return Promise.resolve();
      })
    ])
    .then(() => {
      console.log('[Service Worker] All caches prepared successfully');
      // Force service worker to become active immediately
      return self.skipWaiting();
    })
    .catch(err => {
      console.error('[Service Worker] Installation failed:', err);
      // Still allow installation to complete
      return self.skipWaiting();
    })
  );
});

// Activation - Clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  
  const currentCaches = [CACHE_PRIMARY, CACHE_SECONDARY, CACHE_DATA];
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Delete old caches that aren't current
          if (!currentCaches.includes(cacheName)) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => {
      console.log('[Service Worker] Activation complete');
      // Take control of all clients immediately
      return self.clients.claim();
    })
    .catch(err => {
      console.error('[Service Worker] Activation failed:', err);
    })
  );
});

// Enhanced fetch handler with dual-cache fallback strategy
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests and browser extensions
  if (event.request.method !== 'GET' || 
      event.request.url.startsWith('chrome-extension://') ||
      event.request.url.includes('browser-sync')) {
    return;
  }
  
  // Handle API requests differently
  if (event.request.url.includes('/api/') || 
      event.request.url.includes('.json') && !event.request.url.includes('manifest.json')) {
    handleApiRequest(event);
    return;
  }
  
  // Handle static assets with dual-cache strategy
  event.respondWith(
    handleDualCacheRequest(event.request)
      .catch(error => {
        console.error('[Service Worker] Fetch failed:', error);
        // Ultimate fallback - return offline page
        return getOfflineResponse(event.request);
      })
  );
});

// Dual-cache request handler with intelligent fallback
async function handleDualCacheRequest(request) {
  const requestKey = request.url;
  
  try {
    // Strategy 1: Try network first with cache fallback for fresh content
    const networkResponse = await fetch(request);
    
    if (networkResponse && networkResponse.status === 200) {
      // Cache the fresh response in both caches
      await updateBothCaches(requestKey, networkResponse.clone());
      return networkResponse;
    }
  } catch (networkError) {
    console.log('[Service Worker] Network unavailable, using cache:', networkError);
  }
  
  // Strategy 2: Try primary cache
  const primaryCache = await caches.open(CACHE_PRIMARY);
  let cachedResponse = await primaryCache.match(request);
  
  if (cachedResponse) {
    console.log('[Service Worker] Served from primary cache:', requestKey);
    // Refresh cache in background
    refreshCacheInBackground(request);
    return cachedResponse;
  }
  
  // Strategy 3: Try secondary cache
  const secondaryCache = await caches.open(CACHE_SECONDARY);
  cachedResponse = await secondaryCache.match(request);
  
  if (cachedResponse) {
    console.log('[Service Worker] Served from secondary cache:', requestKey);
    // Also copy to primary cache for faster access next time
    await primaryCache.put(request, cachedResponse.clone());
    return cachedResponse;
  }
  
  // Strategy 4: Try to find similar resource
  cachedResponse = await findSimilarResource(request);
  if (cachedResponse) {
    console.log('[Service Worker] Served similar resource for:', requestKey);
    return cachedResponse;
  }
  
  // Strategy 5: For navigation requests, return the main page
  if (request.mode === 'navigate') {
    const fallbackResponse = await getNavigationFallback();
    if (fallbackResponse) return fallbackResponse;
  }
  
  // All strategies failed
  throw new Error('No cache available');
}

// Update both caches with new content
async function updateBothCaches(requestKey, response) {
  try {
    const cachePromises = [
      caches.open(CACHE_PRIMARY).then(cache => cache.put(requestKey, response.clone())),
      caches.open(CACHE_SECONDARY).then(cache => cache.put(requestKey, response.clone()))
    ];
    
    await Promise.all(cachePromises);
    console.log('[Service Worker] Updated both caches for:', requestKey);
  } catch (error) {
    console.error('[Service Worker] Failed to update caches:', error);
    // Try to update at least one cache
    try {
      const primaryCache = await caches.open(CACHE_PRIMARY);
      await primaryCache.put(requestKey, response.clone());
    } catch (e) {
      // Last attempt with secondary
      try {
        const secondaryCache = await caches.open(CACHE_SECONDARY);
        await secondaryCache.put(requestKey, response);
      } catch (finalError) {
        console.error('[Service Worker] All cache updates failed');
      }
    }
  }
}

// Refresh cache in background without blocking response
async function refreshCacheInBackground(request) {
  // Don't refresh for audio files to save bandwidth
  if (request.url.match(/\.(mp3|wav|ogg|flac)$/i)) {
    return;
  }
  
  setTimeout(async () => {
    try {
      const networkResponse = await fetch(request);
      if (networkResponse && networkResponse.status === 200) {
        await updateBothCaches(request.url, networkResponse);
      }
    } catch (error) {
      // Silent fail - network might be down
    }
  }, 1000); // Delay to avoid blocking
}

// Find similar resource if exact match not found
async function findSimilarResource(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  
  // Check for index.html
  if (path.endsWith('/') || !path.includes('.')) {
    const allCaches = [CACHE_PRIMARY, CACHE_SECONDARY];
    
    for (const cacheName of allCaches) {
      const cache = await caches.open(cacheName);
      const response = await cache.match('/index.html');
      if (response) return response;
    }
  }
  
  // Check for root paths
  if (path === '/' || path === '' || path === '/index.html') {
    const allCaches = [CACHE_PRIMARY, CACHE_SECONDARY];
    
    for (const cacheName of allCaches) {
      const cache = await caches.open(cacheName);
      const response = await cache.match('/');
      if (response) return response;
    }
  }
  
  return null;
}

// Handle API requests with network-first strategy
async function handleApiRequest(event) {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful API responses
        if (response.status === 200) {
          const clonedResponse = response.clone();
          caches.open(CACHE_DATA).then(cache => {
            cache.put(event.request, clonedResponse);
          });
        }
        return response;
      })
      .catch(() => {
        // Try to serve from cache if network fails
        return caches.match(event.request)
          .then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Return empty response for API failures
            return new Response(JSON.stringify({ error: 'Offline' }), {
              headers: { 'Content-Type': 'application/json' }
            });
          });
      })
  );
}

// Get navigation fallback (for SPA)
async function getNavigationFallback() {
  const allCaches = [CACHE_PRIMARY, CACHE_SECONDARY];
  
  for (const cacheName of allCaches) {
    const cache = await caches.open(cacheName);
    const responses = await Promise.all([
      cache.match('/index.html'),
      cache.match('/'),
      cache.match('index.html')
    ]);
    
    for (const response of responses) {
      if (response) return response;
    }
  }
  
  return null;
}

// Ultimate offline fallback
async function getOfflineResponse(request) {
  // Try to return any cached page
  const allCaches = [CACHE_PRIMARY, CACHE_SECONDARY, CACHE_DATA];
  
  for (const cacheName of allCaches) {
    const cache = await caches.open(cacheName);
    const response = await cache.match(request);
    if (response) return response;
  }
  
  // If no cache found, create a basic offline response
  if (request.mode === 'navigate') {
    return new Response(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Endroid Music - Offline</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              background: #000; 
              color: white; 
              text-align: center; 
              padding: 50px; 
            }
            .container { 
              background: #6750A4; 
              padding: 30px; 
              border-radius: 10px; 
              max-width: 400px; 
              margin: 0 auto; 
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Endroid Music</h2>
            <p>⚠️ You are currently offline</p>
            <p>The app will work fully when you reconnect to the internet</p>
            <p>Previously loaded music files may still be available</p>
          </div>
        </body>
      </html>
      `,
      { 
        headers: { 
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache' 
        } 
      }
    );
  }
  
  // For non-navigation requests, return 404
  return new Response('Offline - Resource not available', {
    status: 404,
    statusText: 'Offline'
  });
}

// Cache health check and repair
async function checkCacheHealth() {
  console.log('[Service Worker] Running cache health check...');
  
  const cacheChecks = [
    { name: CACHE_PRIMARY, healthy: false },
    { name: CACHE_SECONDARY, healthy: false }
  ];
  
  // Check each cache
  for (const cacheCheck of cacheChecks) {
    try {
      const cache = await caches.open(cacheCheck.name);
      const keys = await cache.keys();
      
      // Check if critical assets exist
      let criticalAssetsCount = 0;
      for (const asset of CRITICAL_ASSETS) {
        const response = await cache.match(asset);
        if (response && response.status === 200) {
          criticalAssetsCount++;
        }
      }
      
      cacheCheck.healthy = criticalAssetsCount >= CRITICAL_ASSETS.length * 0.8; // 80% threshold
      console.log(`[Service Worker] ${cacheCheck.name} health: ${cacheCheck.healthy ? 'GOOD' : 'POOR'} (${criticalAssetsCount}/${CRITICAL_ASSETS.length} assets)`);
      
    } catch (error) {
      console.error(`[Service Worker] Error checking ${cacheCheck.name}:`, error);
    }
  }
  
  // Repair unhealthy caches
  for (const cacheCheck of cacheChecks) {
    if (!cacheCheck.healthy) {
      console.log(`[Service Worker] Repairing ${cacheCheck.name}...`);
      await repairCache(cacheCheck.name);
    }
  }
}

// Repair a damaged cache
async function repairCache(cacheName) {
  try {
    const cache = await caches.open(cacheName);
    
    // Copy from healthy cache if available
    const healthyCacheName = cacheName === CACHE_PRIMARY ? CACHE_SECONDARY : CACHE_PRIMARY;
    const healthyCache = await caches.open(healthyCacheName);
    
    // Copy all critical assets from healthy cache
    for (const asset of CRITICAL_ASSETS) {
      try {
        const response = await healthyCache.match(asset);
        if (response) {
          await cache.put(asset, response);
          console.log(`[Service Worker] Repaired ${asset} in ${cacheName}`);
        }
      } catch (error) {
        console.error(`[Service Worker] Failed to repair ${asset}:`, error);
      }
    }
    
    console.log(`[Service Worker] ${cacheName} repair completed`);
  } catch (error) {
    console.error(`[Service Worker] Failed to repair ${cacheName}:`, error);
  }
}

// Periodic cache maintenance
setInterval(() => {
  checkCacheHealth().catch(console.error);
}, 24 * 60 * 60 * 1000); // Run once per day

// Message handling for cache management
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => caches.delete(cacheName))
      );
    }).then(() => {
      event.ports[0].postMessage({ success: true });
    });
  }
  
  if (event.data && event.data.type === 'CHECK_CACHE') {
    checkCacheHealth().then(() => {
      event.ports[0].postMessage({ success: true });
    });
  }
});

// Handle sync events for background sync (future enhancement)
self.addEventListener('sync', (event) => {
  if (event.tag === 'cache-refresh') {
    console.log('[Service Worker] Background cache refresh triggered');
    checkCacheHealth();
  }
});

// Handle push notifications (future enhancement)
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push notification received');
  // Push notification handling can be added here
});

console.log('[Service Worker] Loaded successfully with dual-cache strategy');
