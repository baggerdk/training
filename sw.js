// Service worker: gør appen tilgængelig offline. Hæv VERSION ved hver udgivelse.
const VERSION = 'stalkrop-v1.1.0';
const CORE = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/platform.js', 'js/config.js', 'js/auth.js', 'js/vendor/dexie.min.js', 'js/ids.js', 'js/legacy.js', 'js/store.js', 'js/data.js', 'js/templates.js', 'js/app.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];
const IMAGES = [
  "img/ex/Band_Assisted_Pull-Up/0.jpg",
  "img/ex/Band_Assisted_Pull-Up/1.jpg",
  "img/ex/Band_Pull_Apart/0.jpg",
  "img/ex/Band_Pull_Apart/1.jpg",
  "img/ex/Barbell_Deadlift/0.jpg",
  "img/ex/Barbell_Deadlift/1.jpg",
  "img/ex/Barbell_Full_Squat/0.jpg",
  "img/ex/Barbell_Full_Squat/1.jpg",
  "img/ex/Barbell_Hip_Thrust/0.jpg",
  "img/ex/Barbell_Hip_Thrust/1.jpg",
  "img/ex/Barbell_Incline_Bench_Press_-_Medium_Grip/0.jpg",
  "img/ex/Barbell_Incline_Bench_Press_-_Medium_Grip/1.jpg",
  "img/ex/Barbell_Rollout_from_Bench/0.jpg",
  "img/ex/Barbell_Rollout_from_Bench/1.jpg",
  "img/ex/Barbell_Squat/0.jpg",
  "img/ex/Barbell_Squat/1.jpg",
  "img/ex/Bench_Dips/0.jpg",
  "img/ex/Bench_Dips/1.jpg",
  "img/ex/Bench_Press_-_Powerlifting/0.jpg",
  "img/ex/Bench_Press_-_Powerlifting/1.jpg",
  "img/ex/Bent_Over_Barbell_Row/0.jpg",
  "img/ex/Bent_Over_Barbell_Row/1.jpg",
  "img/ex/Bodyweight_Squat/0.jpg",
  "img/ex/Bodyweight_Squat/1.jpg",
  "img/ex/Bodyweight_Walking_Lunge/0.jpg",
  "img/ex/Bodyweight_Walking_Lunge/1.jpg",
  "img/ex/Box_Squat/0.jpg",
  "img/ex/Box_Squat/1.jpg",
  "img/ex/Chin-Up/0.jpg",
  "img/ex/Chin-Up/1.jpg",
  "img/ex/Close-Grip_Barbell_Bench_Press/0.jpg",
  "img/ex/Close-Grip_Barbell_Bench_Press/1.jpg",
  "img/ex/Deficit_Deadlift/0.jpg",
  "img/ex/Deficit_Deadlift/1.jpg",
  "img/ex/Dips_-_Triceps_Version/0.jpg",
  "img/ex/Dips_-_Triceps_Version/1.jpg",
  "img/ex/Farmers_Walk/0.jpg",
  "img/ex/Farmers_Walk/1.jpg",
  "img/ex/Floor_Press/0.jpg",
  "img/ex/Floor_Press/1.jpg",
  "img/ex/Freehand_Jump_Squat/0.jpg",
  "img/ex/Freehand_Jump_Squat/1.jpg",
  "img/ex/Front_Barbell_Squat/0.jpg",
  "img/ex/Front_Barbell_Squat/1.jpg",
  "img/ex/Front_Box_Jump/0.jpg",
  "img/ex/Front_Box_Jump/1.jpg",
  "img/ex/Good_Morning/0.jpg",
  "img/ex/Good_Morning/1.jpg",
  "img/ex/Handstand_Push-Ups/0.jpg",
  "img/ex/Handstand_Push-Ups/1.jpg",
  "img/ex/Hanging_Leg_Raise/0.jpg",
  "img/ex/Hanging_Leg_Raise/1.jpg",
  "img/ex/Hanging_Pike/0.jpg",
  "img/ex/Hanging_Pike/1.jpg",
  "img/ex/Incline_Push-Up/0.jpg",
  "img/ex/Incline_Push-Up/1.jpg",
  "img/ex/Inverted_Row/0.jpg",
  "img/ex/Inverted_Row/1.jpg",
  "img/ex/Mountain_Climbers/0.jpg",
  "img/ex/Mountain_Climbers/1.jpg",
  "img/ex/Muscle_Up/0.jpg",
  "img/ex/Muscle_Up/1.jpg",
  "img/ex/One_Arm_Chin-Up/0.jpg",
  "img/ex/One_Arm_Chin-Up/1.jpg",
  "img/ex/Parallel_Bar_Dip/0.jpg",
  "img/ex/Parallel_Bar_Dip/1.jpg",
  "img/ex/Pin_Presses/0.jpg",
  "img/ex/Pin_Presses/1.jpg",
  "img/ex/Plank/0.jpg",
  "img/ex/Plank/1.jpg",
  "img/ex/Plyo_Push-up/0.jpg",
  "img/ex/Plyo_Push-up/1.jpg",
  "img/ex/Pullups/0.jpg",
  "img/ex/Pullups/1.jpg",
  "img/ex/Push-Up_Wide/0.jpg",
  "img/ex/Push-Up_Wide/1.jpg",
  "img/ex/Push-Ups_-_Close_Triceps_Position/0.jpg",
  "img/ex/Push-Ups_-_Close_Triceps_Position/1.jpg",
  "img/ex/Push-Ups_With_Feet_Elevated/0.jpg",
  "img/ex/Push-Ups_With_Feet_Elevated/1.jpg",
  "img/ex/Push_Press/0.jpg",
  "img/ex/Push_Press/1.jpg",
  "img/ex/Pushups/0.jpg",
  "img/ex/Pushups/1.jpg",
  "img/ex/Rack_Pulls/0.jpg",
  "img/ex/Rack_Pulls/1.jpg",
  "img/ex/Ring_Dips/0.jpg",
  "img/ex/Ring_Dips/1.jpg",
  "img/ex/Romanian_Deadlift/0.jpg",
  "img/ex/Romanian_Deadlift/1.jpg",
  "img/ex/Rope_Jumping/0.jpg",
  "img/ex/Rope_Jumping/1.jpg",
  "img/ex/Scapular_Pull-Up/0.jpg",
  "img/ex/Scapular_Pull-Up/1.jpg",
  "img/ex/Side_Bridge/0.jpg",
  "img/ex/Side_Bridge/1.jpg",
  "img/ex/Side_To_Side_Chins/0.jpg",
  "img/ex/Side_To_Side_Chins/1.jpg",
  "img/ex/Single-Arm_Push-Up/0.jpg",
  "img/ex/Single-Arm_Push-Up/1.jpg",
  "img/ex/Single_Leg_Glute_Bridge/0.jpg",
  "img/ex/Single_Leg_Glute_Bridge/1.jpg",
  "img/ex/Split_Squats/0.jpg",
  "img/ex/Split_Squats/1.jpg",
  "img/ex/Standing_Military_Press/0.jpg",
  "img/ex/Standing_Military_Press/1.jpg",
  "img/ex/Sumo_Deadlift/0.jpg",
  "img/ex/Sumo_Deadlift/1.jpg",
  "img/ex/Superman/0.jpg",
  "img/ex/Superman/1.jpg",
  "img/ex/Suspended_Push-Up/0.jpg",
  "img/ex/Suspended_Push-Up/1.jpg",
  "img/ex/Suspended_Row/0.jpg",
  "img/ex/Suspended_Row/1.jpg",
  "img/ex/Weighted_Pull_Ups/0.jpg",
  "img/ex/Weighted_Pull_Ups/1.jpg",
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(CORE);
    // Billeder hentes i baggrunden – fejl her må ikke stoppe installationen
    await Promise.allSettled(IMAGES.map(u => c.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // App-filer: netværk først (så opdateringer slår igennem), cache som fallback offline
  if (/\.(html|js|css|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/')) {
    e.respondWith(fetch(e.request).then(r => {
      const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
    return;
  }
  // Billeder m.m.: cache først
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
    const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return res;
  })));
});
