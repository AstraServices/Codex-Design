# Araştırma / 26 Ekim 2026

## Claude Design hakkında doğrulananlar

[Anthropic'in Claude Design duyurusu](https://www.anthropic.com/news/claude-design-anthropic-labs) ürünü tasarım, prototip, slayt ve görsel çalışma üretme ortamı olarak tanımlıyor. Bu duyuru, kullanıcının gördüğü belirli 3D örneğin iç modelleme kodunu veya özel rig/export motorunu yayımlamıyor. O örneğin aynen hangi kütüphaneleri kullandığını doğrulanmış bilgi olarak söyleyemeyiz.

[Claude kataloğundaki Three.js 3D Viewer](https://claude.com/marketplace/connectors/threejs-3d-viewer) Three.js ile etkileşimli sahne, model ve animasyon görüntüleme yaklaşımını doğruluyor. Bu ayrı bir demo connector; Claude Design'ın iç mimarisinin kanıtı değil. [Anthropic'in yaratıcı çalışma yazısı](https://www.anthropic.com/news/claude-for-creative-work) ayrıca Blender connector'ünü bağımsız bir entegrasyon olarak açıklıyor.

Bu projedeki sonuç bir çıkarım ve mühendislik kararıdır: Aynı kullanıcı deneyimi için Blender gerekmez. LLM'nin Three.js sahnesi/mesh kodu üretmesi, tarayıcının bunu WebGL ile çizmesi ve exporter'ın sahneyi dosyaya çevirmesi yeterlidir. WebGL tek başına modelleme/rig sistemi değildir; GPU çizim arayüzüdür.

## Seçilen mimari

```text
Kullanıcı → Codex sohbeti → küçük JS model tarifi + JSON parametreler
                                  ↓
                    paylaşılan geometri / rig / animasyon kiti
                                  ↓
                     Three.js sahne grafiği + AnimationClip
                         ↙                         ↘
                 WebGL önizleme              GLB / glTF / OBJ / STL
                       ↑
                 SSE dosya yenileme
```

**Üretim çekirdeği:** Standart primitifler, yuvarlatılmış kutular, lathe profilleri, eğri boyunca tüpler, extrude şekiller ve kullanıcının kodla ürettiği herhangi bir BufferGeometry. `THREE` doğrudan erişilebilir; kit yalnızca kısa ve güvenilir yazım sağlar. Üç sabit model arasından anahtar kelime seçen bir sözde AI generator yoktur. Yeni bir model gerçekten yeni koddan oluşur.

**Topoloji işlemleri:** [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) ile çıkarma, birleşim ve kesişim. Kütüphane deneysel olduğunu ve girdilerin kapalı/two-manifold olması gerektiğini belirtiyor; sonuçların her koşulda manifold olacağını garanti etmiyor. Bu nedenle CAD hassasiyeti veya üretim toleransı iddia etmiyoruz. FORMΑ örneğinde kesilmiş tutamak deliğini raycast testiyle kontrol ediyoruz.

**Rig:** Object3D/Bone hiyerarşisi rijit parçaları taşır. Sürekli yüzeyler için [SkinnedMesh](https://threejs.org/docs/pages/SkinnedMesh.html), Skeleton, bind matrisleri, `skinIndex` ve normalize `skinWeight` kullanılır. Robot zırhı kemiklere bağlı rijit parçalardan, anteni ise ağırlıklı mesh'ten oluşur. Organik çalışma, birden çok kemik etkisini aynı vertex üzerinde karıştırır. Bu gerçek skinning'dir; yalnızca mesh'i döndürmek değildir.

**Animasyon:** [AnimationClip](https://threejs.org/docs/pages/AnimationClip.html) ve typed keyframe track'ler. Hareket fonksiyonları 24/30 FPS örneklenerek quaternion/position track'lerine dönüştürülür. Bu, canlı callback'in export sırasında kaybolmasını önler. Tarayıcı AnimationMixer ile oynatır; indirilen dosyada da aynı klipler vardır. Klip seçme, durdurma, hız değiştirme, zaman çizelgesinde scrub ve kemik görünümü bulunur.

**Görselleştirme:** Yerel Three.js ESM bağımlılıkları, WebGLRenderer, OrbitControls, stüdyo environment, gölge, ACES ton eşleme. Dış CDN'ye her açılışta bağımlılık yoktur. Node sunucusu yalnızca dosya, parametre kaydı ve değişiklik bildirimi sağlar; model üretimi ve render tarayıcıda gerçekleşir.

## Format kararları

[Three.js model yükleme rehberi](https://threejs.org/manual/pages/loading-3d-models.html) runtime içerik için glTF'yi öneriyor. [GLTFExporter](https://threejs.org/docs/pages/GLTFExporter.html) mesh, materyal, skin ve animasyon kliplerini destekliyor. Bu nedenle GLB ana teslim formatıdır. `animations` açıkça exporter'a verilir; `trs:true` kullanılır. Tüm sahneyi değil yalnızca asset root'unu export ediyoruz: önizleme ışıkları, zemin ve grid model dosyasına karışmaz.

| Format | Geometri | PBR | Skin/kemik | Animasyon | Uygulama kararı |
|---|---|---|---|---|---|
| GLB | Evet | Evet | Evet | Evet | Varsayılan; tek binary dosya |
| glTF | Evet | Evet | Evet | Evet | Binary/doku verisi JSON içine gömülü |
| OBJ/MTL | Evet | Hayır | Hayır | Hayır | Görünen poz bake edilir, ZIP içinde taban renk MTL |
| STL | Evet | Hayır | Hayır | Hayır | Görünen poz, binary geometri |
| Three.js JSON | Evet | Three.js materyalleri | Evet | Evet | Three.js'e geri yükleme / geliştirme |
| FBX | Yükleme var | Yükleyiciye bağlı | Yükleyiciye bağlı | Yükleyiciye bağlı | Bu sürümde dışa aktarma yok |

[OBJExporter](https://threejs.org/docs/pages/OBJExporter.html) materyal MTL'si yazmıyor. Bu projede üstüne kontrollü bir statik poz bake ve MTL ZIP katmanı ekledik. Dört ağırlıklı skinning ve morph deformasyonu CPU tarafında o anki pozun vertex'lerine işlenir; OBJ/STL orijinal bind geometrisini yanlışlıkla vermez. MTL'de yalnızca base color/opacity var; doku/PBR kayıpları arayüzde ve pakette belirtilir.

### FBX neden düğme olarak eklenmedi?

Three.js'in kurulu exporter dizininde FBXExporter bulunmuyor. [Three.js bakımcılarının açıklaması](https://discourse.threejs.org/t/3d-models-interconversions/52290) da doğrudan FBX exporter olmadığını belirtiyor. FBX uzantılı GLB dosyası vermek veya yalnızca kutu geometrisi yazıp tam FBX desteği demek doğru olmazdı.

Blender kullanmadan gelecekteki seçenek **Assimp/native ya da özel WASM adapter**: [Assimp format listesi](https://github.com/assimp/assimp/blob/master/doc/Fileformats.md) FBX export'u deneysel olarak listeliyor. [AssimpJS](https://github.com/kovacsv/assimpjs) hazır dağıtımı ise yalnızca assjson/glTF/GLB hedeflerini sunuyor; `npm install assimpjs` tek başına FBX export getirmiyor. Dolayısıyla bu ek bağımlılığı koymak mevcut sorunu çözmez. Tam FBX adapter'ı için skin, bind pose, klip sayısı, süre, texture ve eksenlerin hedef uygulamada round-trip testi gerekir. Bu sürüm bunu tamamlanmış gibi sunmaz.

## Token / maliyet yaklaşımı

Blender kullanmak tek başına yüksek token tüketimi demek değildir; gerçek tüketimi araç cevapları, sahne dump'ları, tekrar edilen kod ve görsel iterasyonlar belirler. Bu sistemin avantajı ölçülmüş bir yüzde değil, daha küçük çalışma sözleşmesidir:

- Görüntüleyici, export ve rig yardımcıları bir kez yazılır.
- Codex yalnızca yeni model tarifini ve gerektiğinde küçük parametre değişikliğini okur/yazar.
- Inspection JSON'u sayımlar, boyutlar, klip isim/süreleri ve uyarılar içerir; yüz binlerce vertex sohbet bağlamına girmez.
- Deterministik tarif aynı geometriyi tekrar üretir; rastgele detay gerekiyorsa seed'i tarifte tutmak gerekir.
- Model varyantlarında materyal ve ölçü parametreleri değişir; tüm sistem yeniden üretilmez.
- Paket içindeki LLM çağrısı, gizli API anahtarı veya ikinci token faturası yoktur. Üretici Codex sohbetidir.

Burada Blender'a karşı token benchmark'ı yapılmadı. Ölçümsüz performans veya token tasarruf yüzdesi iddia edilmiyor.

## Gerçek sınırlar

Bu, kodla prosedürel 3D üretim altyapısıdır. Gerçekçi insan yüzü/topolojisi, sculpt, otomatik UV unwrap, retopoloji, evrensel autorig, motion capture, cloth solver veya metinden öğrenilmiş mesh üretim modeli içermez. Bu tür özelliklerin gerektiğinde ayrı algoritma, veri ya da servis olarak eklenmesi gerekir. Stilize oyun modelleri, mekanik parçalar, prop'lar, organik parametrik yüzeyler ve açıkça tanımlanmış rig'ler güçlü kullanım alanlarıdır.

Import orijinal birimleri korur. glTF'nin metre standardı dışındaki OBJ/FBX varlıklarında boyutları kontrol etmek gerekir. Çok dosyalı import dosya adına göre çözülür; farklı klasörlerde aynı dosya adı varsa önce benzersizleştirmek gerekir. Draco/KTX2 decoder kurulumu yoktur. Doku içeren yeni varlıklar için export uyumluluğu ayrıca kontrol edilmelidir.

## Doğrulama ölçütleri

1. Geometri sonlu, animasyon hedefleri bağlı, isimler tutarlı.
2. Skin ağırlıkları normalize ve kemik indeksleri geçerli.
3. Organik yüzey animasyonda gerçek vertex konumu değiştiriyor.
4. Statik bake sonucu aynı pozun world-space vertex'leriyle uyuşuyor.
5. GLB, Khronos glTF Validator'dan hata almadan geçiyor.
6. Export edilen GLB tekrar yüklenince klip ve skin sayıları korunuyor.
7. Önizleme, import, indirme, parametre değişimi ve mobil viewport tarayıcıda çalışıyor.

Testler bu kriterleri uyguluyor; başka motorlarda genel uyumluluk sertifikası yerine geçmez. Örnek çıktılar ve validator raporları `exports/` altındadır.

## Codex entegrasyonu

### Topoloji araştırması ve eklenen üretim katmanı

[Meshoptimizer'ın resmî JS belgeleri](https://github.com/zeux/meshoptimizer/blob/master/js/README.md) öznitelik farklarını hesaba katan `simplifyWithAttributes`, sınır kilitleme, düzenlileştirme ve vertex compaction API'lerini sağlıyor. Bu projede normal/UV/renk ağırlıkları, LockBorder ve Regularize kullanılıyor. Algoritma hedef indekse ulaşmayı garanti etmiyor; hata ve topoloji sınırları önce geliyor. Weighted yüzeyleri otomatik decimate etmek yerine deformasyon yoğunluğu kaynak halkalarda korunuyor. [Bakımcının skinned mesh açıklaması](https://github.com/zeux/meshoptimizer/discussions/973) da skinning altında kaliteyi tek başına bind-pose azaltma ile garanti etmediği için ayrı değerlendirmeyi gerektiriyor.

Topoloji audit'i UV/normal bölünmelerinden bağımsız pozisyon bağlantısını inceliyor. Optimizasyondaki vertex birleştirme ise bütün öznitelikleri eşit olma koşuluna bağlı: yalnızca pozisyon eşit diye UV dikişi veya farklı kemik ağırlığı birleştirilmez. Düzenli `quadSurface` üretimi ve akıllı yoğunluk seçimi Codex'in modelleme kararını iyileştirir; bu algoritmik raporun kendi başına bir LLM veya otomatik semantic retopo olduğu iddia edilmiyor. GLB hâlâ üçgen tabanlıdır.

[OpenAI skill dokümantasyonu](https://developers.openai.com/plugins/concepts/skills) tekrar eden iş akışlarını bir `SKILL.md` ve yardımcı kaynaklarla tanımlamayı destekliyor. Burada en küçük yeterli entegrasyon seçildi: çalışma alanında `AGENTS.md`, kişisel `codex-design-3d` becerisi, model oluşturma/inspect/export komutları. Ayrı MCP servisi veya yeni API tabanlı asistan kurmak mevcut Codex'in dosya yazma yeteneğini gereksiz yere tekrar ederdi. Gelecekte farklı istemcilerden uzaktan kullanım istenirse bu aynı dar operasyonlar bir MCP araç yüzeyine taşınabilir.

## Roblox Highlight araştırması (2026-10)

- [Highlight sınıfı](https://create.roblox.com/docs/reference/engine/classes/Highlight) ve [Highlighting objects](https://create.roblox.com/docs/en-us/effects/highlighting) şu özellikleri tanımlıyor: `FillColor`, `FillTransparency`, `OutlineColor`, `OutlineTransparency`, `DepthMode` (`AlwaysOnTop` / `Occluded`), `Enabled`, `Adornee`. Highlight bir Model'e veya BasePart'a parent edilir ya da Adornee ile bağlanır. Disabled ya da tamamen saydam bir highlight da limitten yer kaplar.
- [Roblox Rendering Team, 10 Kasım 2025](https://devforum.roblox.com/t/lights-camera-more-highlights/4061534): limit 31'den 255'e çıktı. Highlight'lı her nesne ayrı bir draw call ile çiziliyor. Ekranda highlight varken buna bir post-processing maliyeti ekleniyor.
- [Highlight hata derlemesi](https://devforum.roblox.com/t/all-highlight-related-bugs/2275645) (topluluk gözlemi): outline piksel tabanlı, mesafeyle incelmiyor ve kalınlığı ayarlanamıyor. Highlight ID'leri özel bir ekran dokusuna yazılıyor ve saydam objeler bu veriyi bozabiliyor. Parent/child iç içe highlight önerilmiyor.
- [Saydam parçalar](https://devforum.roblox.com/t/invisible-parts-being-outlined/3231144): Transparency değeri 0.01'in üstünde olan parçalar highlight'tan etkilenmiyor.

Bu projedeki karşılığı şöyle çalışıyor. Viewer'da adornee ayrı bir maske pass'ine (normal + derinlik) çiziliyor. Outline için ayrılabilir, tam bir Öklid mesafe dönüşümü kullanılıyor, böylece kalınlık piksel cinsinden sabit kalıyor. `Occluded` modu sahne derinliğiyle karşılaştırılıyor ve fill, tone mapping'den sonra karıştırılıyor.

glTF'te ekran-uzayı efektler için bir standart yok. Bu yüzden export geometriye bake ediliyor: inverted hull outline (toon/VRM outline'larında yaygın teknik), ince bir unlit fill kabuğu ve kenar şeritleri. Ayarlar `CODEX_highlight` / `CODEX_edges` vendor extension'larında taşınıyor. Validator bunları hata olarak değil, "unsupported extension" bilgisi olarak raporluyor.

Roblox 3D Importer glTF'i PBR ve hiyerarşiyle birlikte alıyor ([importer](https://create.roblox.com/docs/studio/importer)), ama `KHR_materials_unlit` desteği Roblox'ta garanti değil. Bu yüzden `CodexOutline` Luau'su shell'leri Roblox'un kendi özellikleriyle yeniden stilliyor: Neon/SmoothPlastic malzeme, renk ve şeffaflık. `AlwaysOnTop` x-ray etkisi geometriyle taşınamıyor; gerekirse `UseRobloxHighlight` ile yerel Highlight eklenebiliyor.

## LOD / topology araştırması (2026-10)

- Garland & Heckbert, QEM: kenar çökertme, en düşük karesel hatadan başlayarak. [Quadrics PDF](https://www.cs.cmu.edu/~garland/Papers/quadrics.pdf)
- Hoppe 1999, [New Quadric Metric for Simplifying Meshes with Appearance Attributes](https://hhoppe.com/proj/newqem/): attribute hatası yakın nokta eşlemesiyle ölçülüyor. Seam'ler wedge yapısıyla korunuyor. Burada UV hatası, her yüzün afin UV haritasıyla tahmin edilen değerden sapma olarak hesaplanıyor; seam vertex'leri kilitli.
- [Single Edge Collapse Quad-Dominant Mesh Reduction (arXiv 2411.16874)](https://arxiv.org/html/2411.16874): klasik QEM'de animasyon eklemlerini koruyan açık bir araç yok. Joint etkileri attribute olarak ele alınabiliyor. Burada skin ağırlığı farkı ceza olarak ekleniyor ve ağırlıklar collapse sırasında harmanlanıyor.
- [Pose-independent simplification of articulated meshes (DeCoro 2005)](https://gfx.cs.princeton.edu/pubs/DeCoro_2005_PSO/SkeletalSimplification-i3d.ppt) ve [line quadrics (SGP 2025)](https://www.dgp.toronto.edu/~hsuehtil/pdf/lineQuadric.pdf): skinned mesh'lerde eklem bölgelerinin korunması.
- Topoloji kalite ölçütleri: quad dominance, valence-4 oranı ve pole yerleşimi pratikte kullanılan ölçütler ([NoveDGE](https://novedge.com/blogs/design-news/real-time-ready-in-3ds-max-retopology-bake-safe-topology-and-lod-optimization-workflows), [arXiv 2605.26062](https://arxiv.org/pdf/2605.26062)). Skordaki ağırlıklar bu projeye ait; bir endüstri standardı değil.

Sınırlar: bu otomatik retopoloji değil. QuadriFlow veya Instant Meshes gibi bir alan-tabanlı remesh yok. Düzeltici yalnızca şekli değiştirmeyen işlemleri yapıyor. Edge loop eksikliği tarifte (`k.quadSurface`, halka sayıları) giderilmeli.
