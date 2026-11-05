# Codex Design: kodla tasarlayan, Roblox'a teslim eden 3D stüdyo

> Bir cümle yazarsın, AI kodunu yazar, Codex Design modeli, texture'ı, efekti ve tanıtım görselini üretip Roblox'a
> hazır paketler. Blender yok, bulut servisi yok, abonelik yok. Her şey senin bilgisayarında, dosya dosya.

Sürüm: **0.8.1 (custom)**. Lisans: **Codex Design Non-Commercial License** (bkz. `LICENSE`).

---

## 1. Codex Design nedir?

Codex Design, yapay zekâ ajanlarının (Claude, Codex/ChatGPT, Antigravity/Gemini) **kod yazarak** 3D asset ürettiği yerel
bir üretim stüdyosu. Model bir "prompt kutusundan" tahmin edilmiyor; AI bir **recipe** (tarif) yazıyor, Three.js tabanlı
motor bu tarifi gerçek geometriye, kemiğe, animasyona, materyale ve export dosyasına çeviriyor.

Bunun üç sonucu var:
- **Tekrarlanabilirlik:** Aynı tarif ve aynı seed her zaman aynı modeli verir. "Dünkü versiyon daha güzeldi" diye bir şey olmaz.
- **Düzenlenebilirlik:** Her parça isimli ve parametreli. "Kılıcı 2 stud uzat, kabzayı maviye çevir" bir satırlık değişiklik.
- **Paylaşılabilirlik:** Claude'un başladığı modeli Codex devam ettirebilir. Hepsi aynı `projects/`, `textures/`, `vfx/` klasörlerini kullanır.

## 2. Büyük resim: dört stüdyo, bir motor, bir API

| Stüdyo | Adres | Ne yapar |
|---|---|---|
| **3D Workshop** | `http://127.0.0.1:4173/` | Modelleme, rig, animasyon, stud yüzeyleri, Highlight/Edge, topoloji, LOD, export |
| **Texture Studio** | `/texture` | Node graph ile PBR materyal, 3D boyama, otomatik UV, high→low bake, çok motorlu export |
| **VFX Studio** | `/vfx` | Sadece Roblox için efektler: ParticleEmitter, Beam, Trail, ışık, mesh, gerçek `.rbxm`/`.rbxmx` ve Luau |
| **GFX Studio 2.0** | Workshop içinde (`G`) | Ürün kartı, thumbnail, showcase, ray-traced render, EXR, video |

Hepsinin altında aynı motor, hepsinin üstünde aynı **SDK** var. AI isterse arayüze hiç dokunmadan, kod çalıştırarak her
şeyi tetikler; ürettiği her şey yine de arayüzde canlı görünür.

## 3. 3D Workshop: kodla modelleme

- **Recipe sistemi:** Her asset `projects/<slug>.js` + `.json`. `build(k)` fonksiyonu geometriyi, kemikleri ve klipleri kurar.
  Parametreler (renk, uzunluk, segment) arayüzdeki inspector'dan canlı ayarlanır ve recipe'ye geri kaydedilir.
- **Gerçek rig ve animasyon:** `SkinnedMesh`, normalize edilmiş ağırlıklar, `AnimationClip` track'leri. Rijit zırh kemiğe bağlanır;
  bükülen yüzey gerçek ağırlıkla deforme olur. Animasyonlar export'a girer, sadece önizleme değildir.
- **Roblox görünümü:** 1 stud = 0.28 m. `k.part` ile Roblox Part'ı, **StudTrain** stud texture'ları (gerçek Roblox stud
  dokusundan ölçülmüş), `k.voxels`/`k.block` ile her yüzde stud, 22 Roblox materyal preset'i.
- **Surface sistemi:** Rim, glow, vignette ve AO ışık efektleri yüzeye bake edilir; renk gradyanları her model için ayrı
  tasarlanır (linear, radial, spherical, angular, normal, noise, edge, face). Hazır gradyan preset'i bilerek yok: her model kendine özgü.
- **Roblox Highlight ve Edge Outline:** Sadece önizleme efekti değil, dosyanın içine gerçek geometri olarak bake edilir.
  Roblox'ta `CodexOutline` Luau scripti ile kontrol edilir.
- **Topoloji:** 0–100 kalite puanı (quad oranı, pole yeri, eklem çevresindeki edge loop sayısı, manifold), akıllı düzeltme,
  SIMP mühendislik topoloji optimizasyonu ve su geçirmez quad mesher.
- **LOD:** QEM tabanlı; UV, normal, sert kenar ve skin ağırlığına duyarlı. LOD0–LOD3 zinciri tek komutla çıkar.
- **Hibrit CPU + GPU:** GPU sadece render alır; LOD, topoloji denetimi ve kalite puanı CPU worker'larında koşar, sayfa takılmaz.
- **Export:** GLB, glTF, Roblox paketi (texture'lar, rig, düzenlenebilir AnimSave'ler, Studio installer), OBJ+MTL (quad'ları
  korur), STL, Three.js JSON, Luau.

## 4. Texture Studio: node graph ile materyal

Python'la tek seferlik texture betikleri dönemi bitti. Materyal artık bir **node graph** (`textures/<isim>.graph.json`).

- **Seamless ve seed tabanlı:** Bütün üreticiler periyodik, yani her materyal kendiliğinden döşenebilir. Doğrulayıcı dikiş
  çizgisini ölçer. Aynı seed her zaman aynı pikselleri verir; çözünürlükten bağımsızdır (256'dan 4096'ya).
- **Node kütüphanesi:** Perlin, FBM, simplex, ridged, turbulence, Worley/Voronoi (domain warp ile), çatlak, çizik, erozyon,
  gradyan, SDF şekilleri, tuğla, taş, altıgen, ahşap damarı, kumaş, çizgi, nokta, **Roblox stud üretici** (yoğunluk, boyut,
  yükseklik, bevel, stud/inlet/tube), levels, blur, warp, transform, pixelate, posterize, palette lock, color ramp, HSV,
  12 blend modu, math, aşınma maskeleri (edge wear, kir, toz, pas, yosun, kar, buz, kum), eğim ve yükseklik maskeleri,
  **GPU'da çalışan özel GLSL node**, tekrar kullanılabilir **alt graph** (material function).
- **PBR çıkışları:** Base color, normal, roughness, metalness, height, AO, emissive, opacity, curvature, thickness. Eksik
  normal, AO ve curvature height'tan otomatik türetilir. PBR doğrulayıcı albedo enerji aralığını, metalness'ın ikili
  olup olmadığını, normal geçerliliğini ve dikişleri kontrol eder.
- **3D önizleme:** Küre, küp, düzlem, silindir, torus knot, kaya veya kendi GLB'n. Studio HDRI, Roblox benzeri ışık,
  dramatik, düz. Kanal görüntüleme, UV checker, wireframe, döşeme, A/B karşılaştırma.
- **3D boyama:** Model üzerinde fırça, silgi ve doldurma; base color, roughness ve metalness katmanları. Kalem basıncı,
  X simetrisi, geri alma. Boyama export edilen haritalara karışır.
- **Geometri maskeleri:** Modelden curvature, dışbükey/içbükey, eğim, yukarı bakan yüzey, yükseklik ve AO bake edilir.
  "Asteroidin üstüne kar, oyuklarına koyu buz, kenarlarına açık buz" gibi istekler doğrudan yapılabilir.
- **Otomatik UV açma:** Normal açısına göre chart'lara bölme, kendi üstüne katlanan chart'ları bölerek 0 overlap, PCA ile
  hizalama, tek ölçekli yerleşim (eşit texel yoğunluğu). Island, stretch, kullanım oranı istatistikleri.
- **High → low-poly bake:** Cage ile BVH raycast; tangent-space normal, AO, height, curvature ve position haritaları, padding.
  33 bin üçgenlik detay 180 üçgenlik modele saniyeler içinde aktarılır.
- **Export profilleri:** Roblox SurfaceAppearance ve MaterialVariant (`.rbxmx` dahil), Unity URP ve HDRP (MaskMap), Unreal 5
  (ORM, DirectX normal), Godot 4 (`.tres`), Blender, glTF 2.0 (validator'dan temiz `.gltf`), Specular/Glossiness, OpenEXR
  (lineer, 32-bit height). Platform sınırları (PC, konsol, mobil, VR, Roblox) ve GPU bellek tahmini. Çoklu materyal atlas'ı.
  Roblox'a tek tıkla yükleme ve ID'leri `.rbxmx`'e yazma.

## 5. VFX Studio: tamamen Roblox'a özel efektler

Roblox uyumu burada bir export seçeneği değil, mimarinin kendisi. Her katman gerçek bir Roblox sınıfı.

- **Katmanlar:** ParticleEmitter (bütün özellikleriyle: sequence'ler, envelope, squash, orientation modları, flipbook
  Loop/OneShot/PingPong/Random, LightEmission/LightInfluence), Beam (Bezier eğri, genişlik, texture kaydırma), Trail,
  Point/Spot/SurfaceLight, Part mesh (Neon, ForceField), Highlight, Bloom/ColorCorrection/Blur/DepthOfField.
  Zamanlama, burst'ler ve TweenService easing'i ile özellik animasyonları.
- **Kütüphane:** Kullanıcının üç VFX paketinden **63 Roblox'a hazır flipbook** (1024², Grid4x4/8x8, premultiplied
  ölçekleme, siyah arka plandan alpha, pixel art için nearest) ve **93 tekil parçacık texture'ı**. Her birinin lisansı kayıtlı,
  lisansı bilinmeyenler işaretli. Her kayıtta önerilen emitter ayarları var.
- **AI kendi çizer:** Kütüphanede uygun efekt yoksa 16 türde özgün sanat üretir: glow, halka, kıvılcım, yıldız, flare,
  duman, toz, kesik, şimşek, şok dalgası, patlama, ateş, büyü çemberi, enerji küresi, trail ve beam gürültüsü.
- **Önizleme:** Roblox davranışını taklit eden Three.js simülatörü: sürtünme, ivme, spread, envelope'lu sequence'ler,
  additive blending, flipbook modları, beam ve trail. Zaman çizgisinde kaydırma, ölçek mankeni, kalite seviyesi.
- **Doğrulayıcı:** Desteklenmeyen özellik ve shader, flipbook düzeni ile atlas uyuşmazlığı, lifetime sırası, 60 stud ışık
  sınırı, eksik attachment, **eksik asset ID (asla sessiz geçmez)**, PC ve mobil parçacık bütçesi.
- **Export:**
  - **Luau kod üretici:** Tek bir ModuleScript; en üstte kolay bir `CONFIG.Textures` tablosu (image veya decal ID girilir).
    Efektin birebir aynısını kurar ve API'yi döner.
  - **Gerçek `.rbxm` (binary) ve `.rbxmx` (XML):** Roblox Studio'nun kendi okuyucusuyla doğrulandı.
  - **Runtime API:** `VFX.Play / Stop / Pause / Resume / SetSpeed / SetScale / SetColor / Preload / Destroy`, sunucudan
    istemciye `PlayForAll / PlayFor / PlayNear`, havuzlama, otomatik temizlik, mesafe ile ayıklama, otomatik kalite.
  - **Tek tık:** API key gir → flipbook ve texture'ları Roblox'a yükle → ID'leri Luau'ya ve paketlere yaz → ZIP.
  - Decal ID ile image ID farkı otomatik çözülür; çözülemezse sunucu tarafında `InsertService` ile çözülür.

## 6. GFX Studio 2.0: tanıtım görseli üretimi

- **35 preset:** Stüdyo kartı (açık/koyu/renkli), sosyal medya, kapak, banner, Roblox ikonu ve thumbnail'leri, podyum,
  blueprint, halftone, sticker, şeffaf PNG; yeni olarak hero render, studio premium, clay, wireframe pro, topoloji
  incelemesi, UV incelemesi, materyal dökümü, PBR showcase, exploded view, montaj dizisi, rig showcase, animasyon temas
  sayfası, sinematik still, LOD karşılaştırması, teknik blueprint, çoklu açı ızgarası, ray-traced hero ve ray-traced stüdyo.
- **Uzun başlıklar kesilmez:** Önce küçülür, sığmazsa iki dengeli satıra bölünür. Boyut ve mod ayarlanabilir.
- **Render modları:** Beauty, **ray traced** (path tracer: çok sekmeli GI, parlak/metal yansımalar, yumuşak gölgeler,
  emissive, zemin temas gölgesi, kenar korumalı denoise, tüm CPU çekirdekleri), clay, matcap, normal, wireframe,
  solid + wireframe (rig'li modelde de), üçgen yoğunluğu ısı haritası, UV checker, roughness, metalness, emissive, depth.
- **Sunum araçları:** Exploded view, iskelet görünümü, mesh istatistik paneli (üçgen, vertex, materyal, texture, kemik,
  draw call, GPU MB), 36 yönden en iyi açıyı bulan otomatik açı, letterbox, 2×/4× (≈4K/8K) çıktı.
- **Formatlar:** PNG, WebP, JPEG, **OpenEXR HDR beauty pass** (lineer, alpha, 1'in üstündeki değerler korunur), MP4/GIF
  (klip dizisi, crossfade, kesintisiz döngü, turntable), watermark (yazı/logo), arka plan fotoğrafı.
- **Otomatik showcase:** Bir model bitince tek komutla hero, premium kart, clay, wireframe, topoloji ve materyal dökümü.

## 7. AI'lar için kod API'si (SDK)

```bash
npm run codex -- run is.mjs                      # export default async (cd) => { … }
npm run codex -- call texture.export '<json>'    # tek çağrı
POST http://127.0.0.1:4173/api/sdk/<alan>/<işlem>  # HTTP
```

Alanlar: `texture` (graph kurucu, doğrula, önizle, export, atlas), `vfx` (kütüphane, efekt kurucu, çizim, doğrula, Luau,
paket), `uv` (otomatik UV), `bake` (high→low), `gfx` (arka planda render, showcase, video, EXR), `roblox` (key testi,
upload, ID'ler). Örnek `examples/sdk-demo.mjs` dört alanı tek script'te yaklaşık 7 saniyede çalıştırır. Upload her zaman
kullanıcı onayı ister; HTTP üzerinden kapalıdır.

## 8. Roblox ile çalışma

- **Ayarlar (⚙):** Creator Dashboard API key'i yerelde saklanır, sayfaya hiç geri gönderilmez, git'e girmez.
- **İçe aktarma akışı:** Studio bağlantısı yoksa AI *"Roblox Studio bağlantısı göremedim. Doğrudan Roblox'a yükleyip
  ID'leri atayayım mı?"* diye sorar. Bağlantı varsa yükleyip açık place'e eklemeden önce sorar.
- **İzin bildirimi:** Studio bir adresi, klasörü veya izni engellerse AI kullanıcıya tam olarak neyi açması gerektiğini söyler.
- **Studio'da doğrulama:** Binary RBXM, üretilen Luau ve runtime çekirdeği gerçek Roblox Studio'da, place'e hiçbir şey
  eklenmeden, bellekte test edildi.

## 9. Ajanlar için eğitim

`docs/TRAINING.md` ve `Train/<alan>/TRAIN.md` dosyaları ölçülmüş referanslar ve katı kurallar içerir: stud ölçüleri,
Stud Nature video ölçümleri, gradyan referansları, GFX, simülatör item'ları, PBR yazımı, topoloji ve VFX. Davranış kuralları
nettir: istenmeden Highlight veya animasyon eklenmez, gradyanlar ve texture'lar her model için ayrı tasarlanır, ikon paketi
sadece istenince kullanılır. Bu, sinir ağı eğitimi değil; AI'ın uyduğu yazılı bilgi ve bu bilgiyi kodlayan motor.

## 10. Koruma, lisans ve imza

- **Lisans:** Kişisel, eğitim ve değerlendirme amaçlı ücretsiz. Kaynak kodu değiştirmek, yeniden yayınlamak ve
  üretilen çıktıları ticari kullanmak **yazılı izin olmadan yasak** (`LICENSE`).
- **Görünmez imza:** Hiçbir model, texture, efekt veya görselin görüntüsü bozulmaz. İmza sadece metadata'dadır:
  PNG `tEXt` chunk'ları (Software, Copyright, Comment), glTF/GLB `asset.generator`, `asset.copyright` ve
  `asset.extras.codexDesign`, EXR `owner` başlığı, RBXMX yorum satırı ve Manifest, Luau başlık yorumu, JSON `generator` alanları.
- **Okunabilir imza:** Export ZIP adları `_CodexDesign` içerir (örnek: `ice-explosion_CodexDesign.roblox-vfx.zip`).

## 11. Kalite ve doğrulama

- 62 birim testi ve 12 tarayıcı testi (Playwright) geçiyor.
- glTF/GLB çıktıları resmi Khronos validator'ından 0 hatayla geçiyor; EXR dosyaları three.js'in bağımsız okuyucusuyla açılıyor.
- RBXM/RBXMX ve Luau Roblox Studio'da doğrulandı.

## 12. Dürüst sınırlar

Codex Design ne yaptığını abartmaz. Şunlar henüz yok: clone/smudge fırçaları, USD/FBX materyal dosyası (glTF kullanılır),
GPU sıkıştırılmış texture dosyası (motorlar import sırasında sıkıştırır, bellek tahmin edilir), path tracer'da kırılma,
subsurface ve hacim, FBX export. Ray tracing CPU'da çalışır: 800², 16 sample, 12 çekirdekte yaklaşık 35 saniye.

## 13. Başlangıç

```bash
npm install
npm start                                   # http://127.0.0.1:4173
npm run preview -- <slug>                   # modeli aç
npm run texture -- textures/volcanic-rock.graph.json --profile roblox-surfaceappearance,unreal
npm run vfx -- ice-explosion                # Luau + .rbxm + .rbxmx
npm run gfx -- <slug> --preset showcase     # tanıtım seti
npm run codex -- run examples/sdk-demo.mjs  # her şey, koddan
```

Belgeler: `docs/STUDIOS.md`, `docs/API.md`, `docs/AUTHORING.md`, `docs/ROBLOX.md`, `Train/VfxTrain/TRAIN.md`.
