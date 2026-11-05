# Codex Design / 3D Workshop

Blender kullanmadan, Three.js ile koddan **3D model, rig ve animasyon** üreten yerel çalışma sistemi. Modeli Codex bu sohbetten yazar; ortak motor tarayıcıda gösterir ve gerçek dosyaya aktarır. Uygulama içinde ayrı bir LLM çağrısı veya ücretli API yoktur.

## Studios (v0.8 custom build)

- **Texture Studio** — `http://127.0.0.1:4173/texture`: node-graph PBR materials (seamless, seeded), 3D paint, geometry masks, export profiles for Roblox, Unity, Unreal, Godot, Blender, glTF.
- **VFX Studio (Roblox only)** — `http://127.0.0.1:4173/vfx`: imported VFX flipbook library + AI-drawn art, Roblox validator, Luau code generator, `.rbxm`/`.rbxmx`, one-click Open Cloud upload.
- **GFX Studio 2.0** — long titles auto-fit, clay/wireframe/density/UV modes, 16 new presets, automatic showcase.
- **Settings** (⚙ / `,`) — Roblox Creator Dashboard API key (stored locally in `codex.settings.json`, never committed), creator id, studio defaults.

Details: `docs/STUDIOS.md`, `Train/VfxTrain/TRAIN.md`. CLIs: `npm run texture -- textures/<name>.graph.json --profile …`, `npm run vfx -- <id>`, `npm run roblox:upload -- <file>`, `npm run gfx -- <slug> --preset showcase`.

## Kurulum ve otomatik güncelleme

Yeni bir bilgisayarda `install.bat` dosyasını çalıştır: atölyeyi GitHub'dan indirir, `npm install` yapar, C:\, D:\ … sürücülerinde Claude Code, Codex, Antigravity ve `.agents` klasörlerini arar ve `codex-design-3d` skill'inin hangisine kurulacağını sorar.

Sürüm `version.txt` dosyasındadır. `npm.cmd start` her açılışta bu dosyayı GitHub'daki ile karşılaştırır; GitHub'daki daha yeniyse atölye sayfasında "Update available" penceresi çıkar ve "Download update" denirse güncellemeyi geçici klasöre indirir (Downloads'a değil), dosyaları yeniler, `projects/`, `exports/` ve ayarları korur, kurulu skill'leri günceller ve sunucuyu yeniden başlatır. Git klonlarında (geliştirme kopyası) ve `CODEX_NO_UPDATE=1` ile atlanır. Yeni sürüm yayınlamak için `version.txt` değerini artırıp push et.

## Çalıştırma

Node.js 22 veya üzeri gerekir. Bağımlılıklar bu bilgisayarda kuruldu.

```powershell
npm.cmd install
npm.cmd start
```

[Atölyeyi aç](http://127.0.0.1:4173). Proje dosyası değişince önizleme yenilenir. Görünümde sürükleyerek döndür, tekerlekle yakınlaş; `F` kadraja alır, boşluk animasyonu durdurur. Parametre değişikliklerini dosyaya kaydetmek için **Save parameters to project** kullan.

## Codex'e örnek istek

> Codex Design 3D ile stilize, eklemli bir keşif robotu üret. Gerçek kemik hiyerarşisi, idle ve yürüyüş animasyonu olsun. Önizlemeyi aç, animasyonlu GLB dosyasını ver.

Bu klasördeki `AGENTS.md` sonraki sohbetlerde üretim yolunu tarif eder. Ayrıca `C:/Users/astra/.codex/skills/codex-design-3d/SKILL.md` kişisel becerisi kuruldu (kaynağı `skill/SKILL.md`; değişiklikten sonra oraya kopyalanır). Yeni sohbetlerde `$codex-design-3d` ile çağrılabilir; beceri listesinin yenilenmesi gerekebilir.

## Üretim komutları

```powershell
npm.cmd run new -- explorer
# projects/explorer.js içindeki build(k) fonksiyonunu düzenle.
npm.cmd run inspect -- explorer
npm.cmd run export -- explorer glb
npm.cmd run export -- explorer png
npm.cmd run inspect -- explorer --topology
npm.cmd run export -- explorer glb --ratio 0.6
```

Komut satırı export'u için atölye açık olmalı. Headless Chromium ilk kez kurulacaksa `npm.cmd run setup:browser`; bu bilgisayarda kurulum yapıldı. Çıktılar `exports/` klasöründedir. Tarayıcıdaki indirme düğmeleri headless kurulumunu gerektirmez.

| Format | İçerik |
|---|---|
| GLB | Tek dosya; geometri, PBR materyal, skin, kemikler ve tüm klipler |
| glTF | JSON ve içine gömülü binary/texture verisi; rig ve klipler |
| OBJ + MTL ZIP | Görünen pozun geometrisi ve taban renkleri; animasyon/rig yok |
| STL | Görünen pozun geometrisi; renk/rig/animasyon yok |
| Three.js JSON | Three.js sahnesi ve animasyonları; motor bağımlı |
| PNG | Mevcut görünümün ekran görüntüsü |

**İçe aktarım:** GLB, glTF, FBX, OBJ/MTL, STL. Çok dosyalı glTF/OBJ için model, BIN, MTL ve dokuları birlikte seç. Draco/KTX2 gibi sıkıştırılmış varlıklar için decoder kurulumu bu sürümde yok. **FBX dışa aktarımı yok.**

## Roblox: stud, malzeme, ikon, Highlight ve Edge Outline (v0.2)

- **Stud parçalar:** `k.part('Base',[16*k.STUD,k.STUD,16*k.STUD],'#4f9a3f',{top:'studs'})`. Kütüphanedeki stud dokuları da kullanılabilir (`npm.cmd run assets -- --studs`). Zemini sabit gri olan `kek_universal` listeden çıkarıldı.
- **Roblox malzemeleri:** `k.robloxMaterial('Brick',{color})` ile 22 preset var (Neon, WoodPlanks, Slate, Glass…). Dokular deterministik ve GLB'ye gömülüyor.
- **İkon paketi:** `assets/library/` altında yaklaşık 14.000 ikon, doku ve efekt var. Arama için `npm.cmd run assets -- "golden coin"`. `k.iconBadge` bir ikonu 3D rozete çeviriyor. Yalnızca modelin gerektirdiği yerlerde, ara sıra kullanılmalı.
- **Highlight (Roblox):** `k.highlight('Chest',{FillColor:[255,0,0],FillTransparency:0.5,OutlineColor:[255,255,255]})`. İç dolguyu kapatmak için `FillTransparency:1`. Glow ayrı, isteğe bağlı bir ekstra.
- **Edge Outline:** `k.edges('Asset',{color:'#000000',thickness:2})` silüete ve sert kenarlara çizgi çiziyor. İç dolgu varsayılan olarak kapalı.
- **Export'ta da aynı görünüm:** GLB/glTF, ayarları `CODEX_highlight` / `CODEX_edges` extension'larında taşıyor. Outline, fill ve kenar çizgileri de gerçek geometri olarak dosyanın içinde; skin'li modellerde kemiklerle birlikte hareket ediyorlar. `npm.cmd run export -- <slug> lua` Roblox için `CodexOutline` Script/ModuleScript'ini üretiyor. Highlight instance'ı gerekmiyor; renk, aç/kapa ve pulse oyun içinde değiştirilebiliyor.
- **Önizleme:** `npm.cmd run preview -- <slug>` sunucuyu başlatıp tarayıcıyı açıyor. Export edilen dosyanın kendisini görmek için: `http://127.0.0.1:4173/?import=exports/<slug>.glb&baked=1`.
- Viewport'ta bir parçaya tıklayınca seçiliyor. Sağ panelden highlight ve edge ayarları canlı düzenlenebiliyor; "Copy recipe code" ile tarife kopyalanıyor.

## Işık ve texture kuralları (v0.4)

- **Yeni viewer ışığı:** güçlü ana ışık, soğuk dolgu ve arkadan kenar ışığı kamerayla birlikte dönüyor. Ortam ışığı düşük tutuldu, bu yüzden kontrast yüksek. Gölge modele oturtuluyor; temas gölgesi ve SSAO (ambient occlusion) var. Preset'ler: Studio, Dramatic, Soft, Sunset, Roblox day, Classic. ☀ menüsünden veya `L` tuşuyla değişiyor; `?light=dramatic`, manifest'te `"lighting"` ve `npm.cmd run export -- <slug> png --light dramatic` da çalışıyor.
- **CPU + GPU hibrit önizleme (kasma yok):** GPU sadece çiziyor. LOD, küçük parça ayıklama, topoloji denetimi ve kalite skoru CPU worker thread'lerinde paralel çalışıyor (en fazla 6). Ana thread en fazla 12–33 ms bloklanıyor; eskiden 465 ms'ydi. GPU zorlanırsa çözünürlük otomatik düşüyor, rahatlayınca geri çıkıyor. Viewport altında GPU adı, worker sayısı ve çözünürlük görünüyor.
- **İstek yönlendirme:** "modeli optimize et" denince AI modeli tarifte kendisi optimize ediyor; sitenin LOD aracını kullanmıyor. "Akıllı topoloji" denince sitenin Smart Topology özelliği (skor, Smart fix, Quads) kullanılıyor. LOD araçları sadece LOD istenirse kullanılıyor.
- **Texture kuralları:** icon pack sadece kullanıcı isterse kullanılıyor. "Stud" denince yuvarlak procedural stud değil, kütüphanedeki gerçek stud texture'ı (`kek`, varsayılan) geliyor. Bunun dışında AI texture'ları kendisi üretiyor.

## Akıllı LOD optimizer ve topoloji düzeltici (v0.3)

- **LOD slider:** Smart Topology panelinde "Reduce triangles" sürgüsü var. Sürükledikçe model canlı olarak azalıyor. Önce düz alanlar gidiyor; silüet, sert kenarlar, UV seam'leri ve eklem bölgeleri en son. Error limit (Strict / Fine / Balanced / Distant / Aggressive) modeli bozmadan durmayı sağlıyor. LOD0–LOD3 düğmeleri ve "Export LOD chain" ile dört GLB tek ZIP'te iniyor.
- **Skinned modeller de azalıyor:** kemik ağırlıkları birleştirilirken harmanlanıyor ve eklem halkaları korunuyor; animasyon yırtılmadan çalışıyor.
- **Küçük parçaları ayıklama:** çok parçalı modellerde (örümcek gibi) uzak LOD'lar için en küçük parçalar atılabiliyor.
- **Topoloji skoru (0–100, A–F):** quad oranı, n-gon fan'ları, pole yerleri (eklemdeki pole'lar ayrıca işaretleniyor), yoğunluk dengesi, üçgen kalitesi, manifold ve eklem başına ≥3 edge loop.
- **Smart fix:** bozuk yüzleri temizliyor, düz alanlarda edge flip yapıyor, vertex'leri yüzey üzerinde gevşetiyor. Şekil değişmiyor.
- **Quads görünümü:** diagonal'ler gizli quad akışını ve pole'ları (mavi 3, turuncu 5, kırmızı 6+, mor eklemde) gösteriyor.
- Komutlar: `npm.cmd run inspect -- <slug> --quality`, `npm.cmd run export -- <slug> glb --lod 0.5`, `npm.cmd run export -- <slug> glb --lod-chain`. Tarifte: `await k.lod({reduction:0.5})`, `k.quality()`, `k.fixTopology()`.

## v0.6: yüzey sistemi, tasarlanmış gradientler, GFX + watermark, akıllı topoloji

- **Her Train klasöründe `TRAIN.md`** var (ölçümler, kurallar, örnekler); indeks `docs/TRAINING.md`. Videodan en net 20 kare `Train/StudveGradientVideo/frames/`.
- **Yüzey sistemi (her mesh için):** `k.voxels`, `k.block`, `k.paint(anyMesh)`, `k.gradient`, `k.look`. Videodan ölçülen kenar parlaklığı (≈1.8×, renk kayması), glow, merkez vinyeti, AO tek atlas texture'a bake edilir. Look'lar: stud-nature, soft-bevel, gradient-pack, toon, glossy, pastel, neon-edge, worn, clean, flat.
- **Gradient'in 2. özelliği — modele özel renk gradienti:** preset yok, AI her model için kendisi tasarlar: `{stops, type:'linear'|'radial'|'spherical'|'angular'|'normal'|'noise'|'edge'|'face', from:'bottom-left', to:'top-right', mode, only:['#renk']}`. Örnek: `projects/gradient-sign.js` (düz mavi değil, köşeden teal → mavi → mor).
- **PBR:** kütüphane yok; AI kendi materyalini `src/texlab.js` yapı taşlarıyla yazar (`k.pbrSurface(def)`), ya da modele özel `k.paint(mesh,{painter})`. 4K export: `npm run texture -- textures/<isim>.js --size 4096`.
- **GFX:** 19 preset (`npm run gfx -- <slug> --list`), ayarlanabilir watermark (yazı/logo, 9 konum veya döşeme, opaklık, boyut, açı, renk; `gfx.config.json`'a kaydedilir). Kart düzeni artık Codex Design'ın kendi düzeni.
- **Sol panel:** Workspace / Asset Library sekmeleri. × ile model sadece kenar çubuğundan gizlenir, Asset Library'den geri alınır (`workspace.json`). Küçük resimler otomatik üretilir.
- **Akıllı topoloji:** üçgen-6 valans flip'leri kaldırıldı (quad akışını bozuyordu), düz fan kapaklar quad ızgaraya çevrilir, quad eşleme iyileşti (`k.quadify()`); voxel yüzleri su geçirmez (T-junction yok); SIMP parçaları için quad mesher.

## Train: stud, voxel, gradient, GFX, PBR ve topoloji optimizasyonu (v0.5)

`Train/` klasöründeki referanslardan öğrenilenler `docs/TRAINING.md` içinde (kurallar, ölçülmüş paletler, video notları); karışık klasör `Train/catalog.json` ile sınıflandı. Yapay zekâ ağırlığı eğitilmez: öğrenilen stil yazılı kurallar + motor özellikleri olarak gelir.

- **Stud:** varsayılan stud artık StudTrain (`top:'train'`, `'train-mixed'`). Kek sadece istenirse.
- **Voxel + stud + gradient:** `await k.voxels(...)`, `await k.block(...)`, sonra `await k.gradient('Asset')`. Rim + vinyet + AO tek atlas texture'a bake edilir; highlight gerekmez. Örnek: `projects/stud-pine.js`.
- **GFX:** `npm run gfx -- stud-pine --preset card|cover|icon|thumbnail|showcase|transparent|all --title "Pine Tree" --tag NATURE`, ya da workshop'ta ✧ GFX butonu (G tuşu).
- **PBR texture (4K'ya kadar):** `npm run texture -- --list`, `npm run texture -- bark --size 4096` → `exports/textures/`. Tarifte `k.pbrSurface('brick',{size:1024})`. Örnek: `projects/pbr-swatches.js`.
- **Mühendislik topoloji optimizasyonu (SIMP):** `k.topologyPart('Bracket',{case:'cantilever',volfrac:0.35})`. Örnek: `projects/topology-bracket.js`.
- **Davranış kuralları:** istenmeden highlight/outline/glow eklenmez (gerekirse önce sorulur); statik objelere (bambu, ağaç, kaya…) istenmeden animasyon eklenmez.

## İçerik

- **MILO:** Eklemli robot, 13 kemik, ağırlıklı anten, Idle/Walk/Wave.
- **NORI:** 9 kemikli yumuşak gövde, normalize edilmiş skin ağırlıkları, Sway/Curl.
- **FORMA:** Lathe profil, CSG ile kesilmiş tutamak, kapak montaj animasyonu.
- **STUD SHRINE:** Stud'lı Part'lar, Roblox malzemeleri, ikon coin, Highlight + Edge Outline, Idle/Collect.
- `src/kit.js`: geometri, materyal, CSG, rig, skin ve animasyon yardımcıları.
- `src/textures.js`: doku, stud, Roblox malzeme presetleri, ikon kütüphanesi araması, ikon → 3D rozet ve decal.
- `src/highlight.js` / `src/edges.js`: Roblox Highlight ve Edge Outline (viewer + GLB bake + CodexOutline Luau).
- `src/app.js`: canlı WebGL önizleme, animasyon oynatımı, import ve export.
- `server.mjs`: loopback dosya sunucusu, parametre kaydetme ve SSE yenileme.
- `src/topology.js`: topoloji analizi, yüz kalitesi, düzenli quad yüzey üretimi ve kontrollü optimizasyon.

## Akıllı topoloji / optimizasyon

Viewport'taki **Topology** düğmesi üçgen akışını gösterir; açık kenarlar sarı, non-manifold kenarlar pembe, ters yönlü yüz bağlantıları mor çizilir. Wireframe normal üçgen görünümünü ayrıca açar. Sayaçlar hem GPU vertex sayısını hem pozisyona göre birleştirilmiş vertex sayısını gösterir; UV/normal dikişleri yanlışlıkla delik sayılmaz.

**Smart Topology** paneli açık/bozuk bağlantıları, sıfır alanlı, kopya ve ince üçgenleri raporlar. **Optimize geometry** tam öznitelikleri eşit vertex'leri birleştirir, dejenere yüzleri temizler ve statik parçalarda Meshoptimizer ile hedef bütçeye yaklaşır. Normal, UV ve renk hataları hesaba katılır; kenarlar ve dikişler korunmaya çalışılır. Yüzde bir hedef olup hata sınırı nedeniyle tam tutmayabilir. **Clean only** poligon azaltmadan temizlik yapar. **Undo** orijinali geri getirir. İşlemler mevcut oturumu ve indirilen dosyayı etkiler; dosya yenilenince tarife dönülür.

Kemik ağırlıklı yüzeyler ve morph target'lar azaltmadan korunur. Codex `k.quadSurface` ile organik parçayı baştan düzenli halka/quad akışıyla oluşturabilir, `k.audit()` raporuna göre modeli düzeltebilir ve `await k.optimize(...)` işlemini tarifte kalıcı çalıştırabilir. WebGL/glTF teslimi üçgenlerden oluşur; kaynak quad sayısı yazım verisi olarak izlenir. Bu özellik evrensel otomatik retopoloji veya self-intersection çözümü değildir.

## Doğrulama

```powershell
npm.cmd test
npm.cmd run test:browser
```

Testler ağırlıklı deformasyonu, statik pozun bake edilmesini, gerçek CSG deliğini, animasyon hedeflerini, tarayıcı kontrollerini ve GLB → Khronos validator → yeniden import hattını denetler. Validator raporları ve örnek dosyalar `exports/` altına yazılır.

[Model yazma API'si](docs/AUTHORING.md) · [Araştırma ve mimari kararlar](docs/RESEARCH.md)

## v0.7: Roblox transfer

`npm.cmd run export -- <slug> roblox` produces and extracts a Studio package with external PNGs, a common bone palette, native editable animation saves and a modern AnimSaves installer. GLB/glTF downloads and CLI default to the Roblox profile; choose General glTF engines / `--target generic` for generic export. Read [docs/ROBLOX.md](docs/ROBLOX.md). `npm.cmd run verify:roblox -- <slug>` validates a GLB and compares world-space deformation in every clip. Studio verification is still required before claiming importer compatibility.


## License

Codex Design Non-Commercial License (see `LICENSE`): no modification, redistribution or commercial use of the software or its outputs without written permission. Exports carry invisible provenance metadata and `_CodexDesign` in ZIP names. Showcase report: `docs/CODEX-DESIGN-RAPOR.md`.
