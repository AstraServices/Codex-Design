# PROMPT.md — Codex Design 3D için konsept ve model promptu rehberi

> **Bu dosya bir yapay zekâya verilmek için yazıldı.** Okuyan AI, Codex Design'ı hiç görmemiş olabilir. Bu dosyayı
> okuduktan sonra kullanıcıyla birlikte **model konsepti** hazırlar, sonra Codex Design'a (modeli kodla yazan ajan)
> verilecek **eksiksiz model promptunu** yazar. Bütün API isimleri, seçenekler ve kurallar motorun gerçek kaynak
> kodundan alındı. Burada olmayan bir özelliği uydurma.

---

## 0. Sen kimsin, ne yapacaksın (okuyan AI için talimat)

Rolün: **Codex Design prompt mimarı.** Modeli sen üretmiyorsun. Üretimi Codex Design ajanı yapacak. Senin işin, o ajanın
tek seferde doğru modeli yazacağı netlikte bir prompt hazırlamak.

Kullanıcı üç şey isteyebilir:

| Kullanıcı der ki | Sen ne yaparsın | Çıktı formatı |
|---|---|---|
| "şöyle bir konsept hazırla", "fikir ver", "X için konsept" | Fikri tasarıma çevir, 2–3 varyasyon öner | [§8 Konsept formatı](#8-konsept-çıktı-formatı) |
| "model promptu hazırla", "Codex'e verilecek promptu yaz" | Seçilen konsepti teknik prompta çevir | [§9 Model promptu formatı](#9-model-promptu-çıktı-formatı-codex-designa-verilecek) |
| "revize et", "şunu değiştir" | Sadece değişeni yaz, slug'ı koru | [§9.3 Revizyon promptu](#93-revizyon-promptu) |

Çalışma kuralların:

1. **Kullanıcının söylediğini değiştirme.** Söylemediği şeyleri sen tasarla ve "(öneri)" diye işaretle.
2. **Somut ol.** "Güzel mavi" değil `#2f7fd8`. "Büyük" değil `8×10×8 stud`. "Gradient olsun" değil tam gradient spec'i.
3. **Motorun yapamadığını vaat etme** (bkz. [§2 Sınırlar](#2-sınırlar-yapamadıkları)).
4. **Katı kuralları uygula** ([§3](#3-katı-davranış-kuralları-ihlal-etme)). Özellikle: istenmeden highlight, outline,
   glow, ikon ya da animasyon ekleme.
5. Model promptunu **tek kopyalanabilir blok** olarak ver. Kullanıcı onu doğrudan Codex Design'a yapıştıracak.
6. Belirsiz ama kritik bir şey varsa (statik mi, animasyonlu mu? stud'lı mı, düz mü?) **tek satırda sor**. Küçük
   şeyleri sorma, kendin seç ve gerekçesini tek cümleyle yaz.
7. **Resim/referans isteme.** Kullanıcı sadece kelimelerle anlatır. Şekil, boyut, oran, stil, malzeme, yüzey, renk,
   gradient, hareket ve sunum için her kelimeyi [§7](#7-görsel-olmadan-anlama-her-şey-için-kelimeden-spece)
   tablolarıyla sayıya çevir. Gradient için ayrıca [§5.5-C](#c-görsel-olmadan-gradienti-anlamak-kelimeden-spece).
8. **Her bölümü insan diliyle geri oku.** Sayıların yanına "nasıl görünecek" cümlesi yaz. Kullanıcı resim görmeden
   sonucu kafasında canlandırabilmeli.

---

## 1. Codex Design nedir

- Yerel çalışan, **Three.js tabanlı prosedürel 3D modelleme + rig + animasyon motoru.** Blender yok. Modeli bir AI ajanı
  (Codex) **JavaScript tarif (recipe) olarak yazar**: `projects/<slug>.js` içinde `build(k)` fonksiyonu + `projects/<slug>.json` manifest.
- `k` = kit. Geometri, malzeme, CSG, kemik, skin, animasyon, doku, stud, voxel, gradient, look, highlight, topoloji, LOD
  yardımcılarının hepsi `k.` altında.
- Tarayıcıda canlı önizleme: `http://127.0.0.1:4173/?project=<slug>`. Dosya değişince yenilenir. Sağ panelde manifest'te
  tanımlanan **parametreler** (renk/sayı slider'ları) canlı değişir.
- Çıktı: GLB / glTF / OBJ+MTL / STL / Three.js JSON / PNG / Lua (CodexOutline) / GFX görselleri ve MP4/GIF.
- Uygulamanın içinde ayrı bir AI veya text-to-mesh servisi **yok**. Her model, ajanın yazdığı koddan oluşur. Bu yüzden
  prompt ne kadar net olursa model o kadar iyi olur.

### Birimler ve eksenler (promptta bunlarla konuş)

| Kavram | Değer |
|---|---|
| 1 stud | `k.STUD` = **0.28 m**. Roblox ölçüsü. Boyutları **tam stud** ver (8, 12, 16…). |
| Birim | metre |
| Eksen | **Y yukarı, +Z ileri** (modelin önü +Z'ye bakar) |
| Pivot | Prop'larda **taban merkezi** |
| Voxel | 1 voxel = 1 stud (varsayılan) |
| Roblox sınırı | mesh başına ≤ 20.000 üçgen, doku ≤ 1024² |
| Atlas | `pxPerStud` 32 (varsayılan), `maxAtlas` 2048; Roblox'a gidecek prop'larda 1024 öner |

---

## 2. Sınırlar (yapamadıkları)

Bunları promptta isteme; kullanıcı isterse dürüstçe söyle:

- **FBX dışa aktarım yok** (FBX içe aktarım var).
- GLB/glTF her zaman **üçgen**. Quad'ları korumak gerekiyorsa **OBJ** export (`--topology subdivision`).
- **Otomatik insan autorig'i yok.** Kemikleri ajan elle kurar; sen kemik listesini ver.
- **Text-to-mesh, fotoğraftan model, otomatik retopoloji yok.** Her şey kodla modellenir.
- Draco / KTX2 sıkıştırılmış dosya import'u yok.
- Highlight'ın `AlwaysOnTop` (duvar arkasından görünme) modu GLB geometrisine yazılamaz; bake edilmiş kabuk `Occluded` gibi davranır.
- OBJ/STL rig ve animasyon taşımaz. OBJ sadece taban rengi/opaklık taşır (PBR dokuları değil).
- Kamera efektleri, malzeme uniform animasyonları, JS callback'leri export edilebilir animasyon **değildir**. Animasyon =
  position / quaternion / scale / morph track'leri.
- CSG (boolean) sadece basit, kapalı (watertight), tek malzemeli statik parçalarda güvenilir.

---

## 3. Katı davranış kuralları (ihlal etme)

Codex Design ajanı bu kurallara uyar. Promptun bunlarla çelişirse ajan ya reddeder ya da yanlış yapar. Sen de uy:

1. **Highlight / Edge Outline / glow / sticker outline asla kendiliğinden yok.** Sadece kullanıcı isterse. Stud ve
   gradient stili derinliğini bake edilmiş look'tan alır, outline'dan değil.
2. **Animasyon asla kendiliğinden yok.** Statik prop'lar animasyonsuz kalır: bitki, bambu, ağaç, kaya, mobilya, bina,
   alet, silah, yemek, mücevher, tabela. Sallanma, süzülme, dönme, idle hiçbiri. Sadece karakter, yaratık, mekanizma
   veya kullanıcı açıkça isterse.
3. **Stud = StudTrain doku.** Varsayılan `'train'`, alternatif `'train-mixed'`. **Kek** sadece kullanıcı "Kek" derse.
   `'square'`, `'square-mixed'`, `'universal-hd'` sadece istenirse. Yuvarlak prosedürel `'studs'` / `'inlet'` sadece
   "yuvarlak stud" istenirse. Gerçek 3D stud silindiri (`studs:'mesh'`) sadece istenirse. Bir modelde yuvarlak ve
   StudTrain stud'ları **karıştırma**. Stud'ları **germe**: boyutlar tam stud olmalı.
4. **Gradient preset'i yoktur.** Her gradient modele özel tasarlanır (stops, type, yön, mode). Renkli bir obje (tabela,
   gem, pet, panel) kullanıcı "düz renk" demedikçe **tasarlanmış renk gradienti** alır.
5. **Look preset'i yoktur.** Sadece `'default'` (ölçülmüş) ve `'flat'` isimli. Geri kalanı **look objesi** olarak
   yazılır. `'soft-bevel'`, `'toon'`, `'glossy'`, `'neon-edge'`, `'stud-nature'` gibi **isimleri string olarak yazma**:
   motor hata verir. Bunun yerine [§5.4](#54-look-yüzey-ışığı-parametreleri)'teki gibi obje ver.
6. **Doku kütüphanesinden seçilmez.** PBR dokuyu ajan modele özel yazar. Örnek dokular (`stone wall`, `bark`…) öğrenmek
   içindir, katalog değildir.
7. **İkon paketi sadece istenirse.** `assets/library` ikonları (`k.iconBadge`, `k.iconPlane`, ikonlu `k.decal`) kullanıcı
   açıkça ikon/amblem/ikon paketi istemedikçe kullanılmaz.
8. **"Optimize et" ≠ "akıllı topoloji" ≠ "LOD".** Bkz. [§5.10](#510-topoloji-optimize-lod).
9. Template / anahtar kelime üreticisi değil, **gerçek silüet ve modellenmiş detay** istenir.

---

## 4. Codex Design'ın iş akışı (promptun hangi adımları tetiklediği)

```
1. npm run new -- <slug>                → projects/<slug>.js + .json
2. build(k) içinde modelleme            → geometri, malzeme, yüzey, gradient, rig, klipler
3. npm run inspect -- <slug> [--quality|--topology]   → boyut, üçgen, kemik, klip, skor
4. npm run preview -- <slug>            → tarayıcıda önizleme
5. npm run export -- <slug> glb|png|...  → exports/
6. npm run gfx -- <slug> --preset ...    → sunum görselleri
```

Senin promptun bu adımların her biri için gereken bilgiyi vermeli: **slug, form, yüzey, renk, rig, klipler, bütçe,
export, GFX.**

---

## 5. Yetenek referansı

### 5.1 Geometri

`k.mesh(name, type, args, material, {parent, at:[x,y,z], rotate:[x,y,z] (radyan), scale})`. İsimler benzersiz ve harfle başlar (animasyon hedefleri bu isimleri kullanır). `k.group`, `k.bone` aynı seçenekleri alır.

| Tip | Ne için iyi |
|---|---|
| `box`, `roundedBox` | Bloklar, sandık, gövde; roundedBox = yumuşak köşe (pet, oyuncak) |
| `sphere`, `capsule`, `icosahedron` | Göz, kafa, uzuv, düşük poligon kaya |
| `cylinder`, `cone` | Gövde, sap, boynuz, çivi |
| `torus` | Halka, yörünge, sap tutamağı |
| `lathe` | Dönel profil: vazo, yumurta, şişe, kase, kupa |
| `tube` | Eğri boyunca boru: kablo, dal, kuyruk, sarmaşık |
| `extrude` | 2D çizimden kalınlık: kılıç bıçağı, logo, yaprak, tabela |
| `k.quadSurface((u,v)=>[x,y,z], {uSegments, vSegments})` | Düzenli quad akışlı organik yüzey (bükülecek gövdeler) |
| Özel `BufferGeometry` | Matematiksel/özel topoloji |
| `k.csg(name, a, b, 'subtract'\|'union'\|'intersect')` | Delik açma, birleştirme (basit parçalarda) |

Malzeme: `k.material(color, {roughness, metalness, emissive, emissiveIntensity})`. Cam/clearcoat için `MeshPhysicalMaterial`.

### 5.2 Roblox Part ve stud

`await k.part(name, [w,h,d], color, {surface, top, bottom, studs, material, ...yerleşim})`
- Boyut metre; `8*k.STUD` gibi tam stud kullan.
- `top`: `'train'` (varsayılan), `'train-mixed'`, `'smooth'`, `'none'`; istenirse `'kek'`, `'square'`, `'square-mixed'`,
  `'universal-hd'`, `'stud-3'`, yuvarlak `'studs'`/`'inlet'`.
- `surface`: yan yüzlerin Roblox malzemesi (varsayılan `Plastic`).
- Stud sadece kullanıcı stud / studded / brick görünüm isterse. Yoksa `top:'none'` veya `'smooth'`.

Stud nereye gider:
- Roblox Part görünümü (sadece üst yüz) → `k.part`
- Voxel / stud-nature görünümü (her yüz) → `k.voxels`, `k.block`
- Herhangi bir mesh → `k.paint(mesh, {studs:'train'})` (düz yüzlerde en iyi)
- `studStrength` 0–1 (varsayılan 0.9), `studScale` (ahşap kirişte ≈2: voxel başına 2 stud). Büyük gradient
  panellerde/tabelalarda genelde `studs:'none'` daha iyi.

### 5.3 Yüzey sistemi (voxel, block, paint)

Tek bake hattı:

```
taban renk → tasarlanmış renk gradientleri → painter.albedo → StudTrain overlay → look (rim, glow, vignette,
face gradient, AO, grime, sheen, posterize…) → ışık gradientleri → atlas (+ ORM / normal / emissive)
```

| Çağrı | Ne yapar |
|---|---|
| `await k.voxels(name, {size:[nx,ny,nz], fill:(x,y,z)=>renk\|null})` | Matematikle voxel hacim (ağaç tacı, kaya, meyve) |
| `await k.voxels(name, {cells:[[x,y,z,renk],…]})` | Tek tek voxel listesi |
| `await k.voxels(name, {rows:['..##..',…], palette:{'#':'#222'}, depth})` | Piksel art'tan kalınlık (anahtar, coin, yaprak, tabela; 1–2 voxel kalın) |
| voxels ek seçenekleri | `voxel` (kenar m, varsayılan 1 stud), `look`, `studs`, `gradient`, `painter`, `colorEdges`, `concaveRims`, `at/rotate/scale/parent` |
| `await k.block(name, [w,h,d], color, {colors:{top,bottom,left,right,front,back}, look, studs, gradient, painter, at})` | Tek bake'li blok |
| `await k.paint(target, {look, studs, gradient, painter, occlusion:true, crease, hardAngle, pxPerStud})` | **Her mesh'e** yüzey: rim sadece sert kenarlarda, skin korunur, `occlusion:true` = ray-traced AO |
| `await k.gradient(target, spec \| 'light')` | Gradient ekler (üst üste biner, yeniden bake eder) |
| `await k.look(target, 'default' \| 'flat' \| {…})` | Look'u sonradan değiştirir |

Voxel kuralları: 1 voxel = 1 stud, organik hatlar basamaklı; piksel art hücreleri köşeden değil **kenardan** bağlı olmalı
(su geçirmez). Aynı silüet + farklı renkler = varyant. Karma stil olabilir: mücevher pürüzsüz yüzeyli (`k.mesh` + `k.paint`), gövde voxel.

### 5.4 Look (yüzey ışığı) parametreleri

`look` = `'default'` | `'flat'` | **obje**. Obje, aşağıdaki varsayılanların üzerine yazılır. Sadece değiştirdiğin anahtarları yaz.

| Grup | Anahtarlar (varsayılan) | Anlamı |
|---|---|---|
| Rim | `rim` 0.7, `rimWidth` 0.07 stud, `rimSoftness` 0.5, `rimLighten` 0.32, `rimSaturate` 1, `rimHue` 0, `rimColor` null | Dış (konveks) kenarlarda açık renkli ince çizgi |
| Rim modu | `rimMode` `'hsl'` (yumuşak, ölçülmüş) \| `'gain'` (parlak kenar: renk×`rimGain` 1.75 + `rimLift` 0.16) | `'gain'` = parlayan v0.6 kenar görünümü |
| Glow | `glow` 0.12, `glowWidth` 0.12, `glowColor` null | Rim'den sonra yumuşak sönme |
| Vinyet | `vignette` 0.16, `vignetteStart` 0.15, `vignetteEnd` 1, `vignettePower` 1, `vignetteColor` null | Yüz ortası biraz koyu |
| Yüz gradienti | `faceGradient` 0.08, `faceGradientDir` `'up'`\|`'down'`\|[x,y,z] | Her yüz bir yöne doğru açılır |
| AO | `ao` 0.5, `aoColor` null | İç köşelerde koyuluk |
| Renk düzeltme | `brightness` 1, `contrast` 1, `saturation` 1, `gamma` 1, `hueShift` 0 (derece), `lift` 0, `posterize` 0 | Global grade; posterize = toon bantları |
| Tahta oluk | `grooves` 0, `grooveEvery` 1, `grooveWidth` 0.05, `grooveLip` 0.5, `grooveDir` `'long'`\|`'short'`\|`'u'`\|`'v'`, `grooveOffset` 0 | Kalas/kütük derzleri |
| Efektler | `sheen` 0 (+`sheenDir`, `sheenOffset`, `sheenWidth`), `edgeNoise` 0 (+`edgeNoiseScale`), `grime` 0 (+`grimeHeight`), `speckle` 0, `emissiveRim` 0 | Parlama bandı, aşınmış kenar, kir, benek, parlayan rim |
| Kenar davranışı | `concaveRims` false, `colorEdges` (voxel) true | İç köşede rim / renk sınırında rim |
| Tam kontrol | `shade(ctx,color)`, `post(ctx,color)` | Gölgelemeyi baştan yazma |

**Hazır başlangıç objeleri** (isim değil, bunları kopyalayıp değiştir):

```js
const glowEdge   = { rimMode:'gain', rimGain:1.75, rimLift:0.16, rim:0.82, rimWidth:0.085, glow:0.32, glowWidth:0.2, vignette:0.2 }; // kullanıcının sevdiği parlak kenar
const glowSoft   = { rimMode:'gain', rimGain:1.4, rimLift:0.08, rim:0.6, rimWidth:0.07, glow:0.18, glowWidth:0.15, vignette:0.18 };
const softBevel  = { rim:0.45, rimWidth:0.06, rimLighten:0.25, glow:0.08, vignette:0.1, faceGradient:0.1 };   // büyük gradient paneller
const toon       = { rim:1, rimWidth:0.1, rimSoftness:0.1, glow:0, vignette:0.22, posterize:5, saturation:1.15 };
const glossy     = { rim:0.6, rimLighten:0.45, vignette:0.12, sheen:0.35, sheenDir:[1,1,0], sheenOffset:0.55, sheenWidth:0.1 };
const neonEdge   = { rim:1, rimLighten:0.6, glow:0.4, glowWidth:0.25, vignette:0.35, brightness:0.7, saturation:1.2, emissiveRim:0.8 };
const worn       = { rim:0.5, rimWidth:0.08, edgeNoise:0.9, grime:0.3, speckle:0.06, ao:0.65, saturation:0.95 };
const pastel     = { rim:0.5, rimLighten:0.5, rimSaturate:0.6, vignette:0.06, lift:0.1, saturation:0.85, ao:0.3 };
const woodBeam   = { rim:0.65, rimSaturate:1.15, grooves:0.35, grooveEvery:1, grooveDir:'long', vignette:0.12 }; // + studScale:2
const stoneBlock = { rim:0.6, rimSaturate:0.4, rimLighten:0.45, vignette:0.18, ao:0.6 };                          // + studStrength:0.5
const goldPiece  = { rim:0.75, rimSaturate:1.3, rimLighten:0.4, glow:0.15, sheen:0.2 };
const vinylToy   = { rim:0.3, rimLighten:0.2, glow:0.05, vignette:0.04, ao:0.35 };                                // pet: düşük rim, neredeyse vinyet yok
```

Stud Nature videosundan ölçülen gerçekler: rim yüzden açık ve ince (~0.07–0.1 stud), sadece **dış kenarda**; altın/sarı
rimler daha doygun, taş rimleri gri-beyaza kayar; yüz ortası biraz koyu (≈90 → 77 luminans); iç köşeler koyu AO,
rim yok; outline/highlight **yok**.

### 5.5 Gradient — EN ÖNEMLİ BÖLÜM

Codex Design'da "gradient" **iki ayrı özellik** demektir. İkisini de bilinçli kullan.

#### A) Yüzey ışığı (model geneli aydınlık gradienti)

`await k.gradient('Asset', 'light')` = `{mode:'light', bottom:0.5, top:1.12}`. Taban koyu → tepe açık. Ölçüm: çam ağacı
tepe/taban luminansı ≈ 2.5×. Model başına ayarla: `{mode:'light', bottom:0.45, top:1.15}`. İsteğe bağlı `tint` (0–1),
`tintBottom` (varsayılan `#20194a`), `tintTop` (`#fff4c8`) ile alt soğuk/üst sıcak renk kayması.
Look + light gradient birlikte = stud/voxel stilinin derinliği.

#### B) Modele özel tasarlanmış renk gradienti (kullanıcının asıl istediği)

Mavi tabela düz mavi olmamalı. AI her obje için gradient **tasarlar**.

**Tam spec** (stops/colors dışında hepsi isteğe bağlı):

| Anahtar | Değerler | Not |
|---|---|---|
| `stops` | `[[0,'#33c3c9'],[0.45,'#2e7da3'],[1,'#3b1a72']]` | t 0–1 + renk. Veya `colors:['#..','#..']` (eşit aralık) |
| `type` | `'linear'` (varsayılan), `'radial'`, `'spherical'`, `'angular'`, `'normal'`, `'noise'`, `'edge'`, `'face'` | aşağıdaki tabloya bak |
| `from` / `to` | `[x,y,z]` metre veya kelime: `'bottom'`, `'top'`, `'left'`, `'right'`, `'front'`, `'back'` ve birleşimleri `'bottom-left'`, `'top-right-front'`, `'center'` | linear için iki uç |
| `direction` | `[x,y,z]` | linear/normal için yön (from/to yerine) |
| `axis` | `'x'`\|`'y'`\|`'z'` (`'none'` = radial'i küresel yap) | linear yönü; radial/angular dönme ekseni |
| `center` | kelime veya `[x,y,z]` | radial/spherical/angular merkezi |
| `radius` | × sınır köşegeni (varsayılan 0.5 = merkezden köşeye) | veya `radiusMeters` |
| `space` | `'part'` (bu mesh; voxels/block/paint'te varsayılan), `'model'` (tüm asset; `k.gradient`'te varsayılan), `'world'` | |
| `mode` | `'replace'` (varsayılan), `'tint'` (açık/koyuyu korur, tonu değiştirir), `'multiply'`, `'overlay'`, `'screen'`, `'soft-light'`, `'light'` | |
| `amount` | 0–1 | karışım oranı |
| `ease` | `'linear'`, `'smooth'`, `'ease-in'`, `'ease-out'` | |
| `curve` | sayı (üs) | |
| `steps` | tamsayı | bantlı toon rampa |
| `repeat` | `'clamp'`, `'repeat'`, `'mirror'` | |
| `offset` | sayı | linear/radial/angular kaydırma |
| `scale`, `seed` | noise ölçeği / tohum | sadece `noise` |
| `only` | `['#2a8e28']` | sadece o taban renkli texel'ler (çok renkli voxel'de yaprak vs gövde) |
| `where` | `ctx => ctx.worldNormal.y > 0.5` | özel maske (kod) |

**Tipler ne zaman:**

| type | Hesap | En iyi kullanım |
|---|---|---|
| `linear` | from→to ya da eksen boyunca | bitki, ağaç, sütun (alt→üst); tabela köşeden köşeye |
| `radial` | merkezden uzaklık (eksene dik düzlemde) | tabela/panelde köşeden parlama, göbek ışığı |
| `spherical` | merkezden 3D uzaklık | mücevher içi parlama, yumurta, top |
| `angular` | eksen etrafında açı | kristal, gökkuşağı, "secret" rarity |
| `normal` | yüzey normali·yön | üstten ışıklı kaya (`direction:[0,1,0]`), kar örtüsü |
| `noise` | fbm leke | yosun, pas, nebula, kamuflaj |
| `edge` | kenar → merkez | çerçeve, ışıklı kenar |
| `face` | yüzün yukarı bakışı | yüz başına basit ton farkı |

**Yığılma sırası:** gradientler çağrı sırasıyla üst üste biner ve atlasa yeniden bake edilir. Renk gradientleri önce,
sonra stud + look, en son light gradient.

#### Gradient tasarım kuralları (uygula)

1. **Işık hikâyesi seç:** parlama ışık/emissive kaynağın olduğu yerde olur (köşe, tepe, mücevherin merkezi).
2. **3–4 stop:** highlight (açık, daha doygun ya da cyan/sarıya kaymış), base, shadow (koyu, maviye/mora kaymış),
   isteğe bağlı derin vurgu. **Sadece parlaklığı değil tonu da kaydır:** teal → blue → indigo → purple.
3. **Değer kontrastı:** küçük prop'larda uç stoplar arası ≥ 2×; büyük düz panellerde ~1.5×.
4. **Tip seçimi:** tabela/panel → köşeden radial; bitki/ağaç/sütun → alttan üste linear; kristal/secret → angular;
   üstten ışıklı kaya → `normal` + `direction:[0,1,0]`; yosun/pas → noise.
5. Büyük gradient panellerde rim'i hafiflet (`softBevel` benzeri look), rim rampayla kavga etmesin.
6. Çok renkli modelde her bölgeye ayrı gradient ver (`only:['#renk']`).

#### Ölçülmüş paletler (referans; preset değil, ilham)

| Malzeme | koyu → orta → açık |
|---|---|
| Yaprak | `#1c5821 #227323 #2a8c27` |
| Çalı/çim | `#103b16 #2b8c27 #46c938` |
| Kaktüs | `#1f401d #438525 #81c939` |
| Ağaç kabuğu | `#191112 #5d2b1d #8b4934` |
| Sıcak ahşap | `#603926 #995f39 #c38148` |
| Kum kaya | `#6a523b #a28561 #d6cdac` |
| Koyu kaya | `#201c19 #5c4832 #876b48` |
| Mavi taş | `#1e2547 #465280 #7281b6` |
| Kemik | `#30292a #887c7c #d6cbc8` |

#### Örnek gradient spec'leri (kalıp olarak kullan)

```js
// Tabela: sol alttan teal parlama → sağ üst koyu mor
{ type:'radial', center:'bottom-left', axis:'z', radius:1.2,
  stops:[[0,'#33c3c9'],[0.45,'#2e7da3'],[0.75,'#2f4f8f'],[1,'#3b1a72']] }

// Çam yaprakları: alttan koyu → üstte açık lime, sadece yaprak rengine, tonu koruyarak
{ type:'linear', from:'bottom', to:'top', space:'part', mode:'tint', amount:0.55, only:['#2a8e28'],
  stops:[[0,'#0f3b16'],[0.55,'#2a8e28'],[1,'#9be35a']] }

// Kristal: eksen etrafında gökkuşağı (secret tier)
{ type:'angular', axis:'y', center:'center',
  stops:[[0,'#ff4fd8'],[0.33,'#5fc4ff'],[0.66,'#7cff6a'],[1,'#ff4fd8']] }

// Mücevher: merkezde açık → kenarda derin kırmızı
{ type:'spherical', center:'center', radius:0.6, ease:'smooth',
  stops:[[0,'#ffb3c1'],[0.5,'#e0193f'],[1,'#5a0018']] }

// Kaya: üstten ışık, yüz normaline göre
{ type:'normal', direction:[0,1,0], mode:'multiply', amount:0.6,
  stops:[[0,'#5c4832'],[1,'#ffffff']] }

// Yosun lekesi: sadece üst yüzlerde, noise
{ type:'noise', scale:2, mode:'replace', amount:0.7, where: ctx => ctx.worldNormal.y > 0.4,
  stops:[[0,'#3f6b2a'],[1,'#7fb34a']] }

// Toon bantlı gün batımı
{ type:'linear', from:'bottom', to:'top', steps:4, stops:[[0,'#3b1a72'],[0.5,'#ff5f8f'],[1,'#ffd34d']] }

// Model geneli ışık
'light'   // veya { mode:'light', bottom:0.45, top:1.15, tint:0.3 }
```

#### C) Görsel olmadan gradienti anlamak: kelimeden spec'e

Kullanıcı çoğu zaman **resim vermez**, sadece "turkuazdan mora geçsin", "köşesi parlasın", "lav gibi" der. Sen bu
kelimelerden **tam spec** çıkarırsın. Kullanıcıdan referans görsel isteme; aşağıdaki adımları uygula.

**Adım 1: Cümleden 6 bilgi çıkar.** Söylenmeyeni tablolardan tamamla.

| Bilgi | Soru | Söylenmezse |
|---|---|---|
| Renkler | Hangi renkler, hangi sırayla? | Obje tipinin varsayılanı (Adım 5) |
| Yön / ışık kaynağı | Nereden nereye? Nerede parlıyor? | Obje tipinin varsayılanı |
| Şekil | Düz geçiş mi, halka mı, dönen mi, leke mi, kenar mı? | linear |
| Sertlik | Yumuşak mı, bantlı mı? | `ease:'smooth'` |
| Güç | Tamamen mi boyasın, hafif mi? | `mode:'replace'`, `amount:1` |
| Bölge | Hangi parça? Tüm model mi? | Ana renkli parça, `space:'part'` |

**Adım 2: Yön ve şekil kelimeleri → spec.**

| Kullanıcı der ki | Spec |
|---|---|
| "alttan üste", "aşağısı koyu yukarısı açık" | `type:'linear', from:'bottom', to:'top'` |
| "yukarıdan aşağı" | `type:'linear', from:'top', to:'bottom'` |
| "soldan sağa" / "sağdan sola" | `from:'left', to:'right'` / `from:'right', to:'left'` |
| "önden arkaya" | `type:'linear', axis:'z'` (veya `from:'front', to:'back'`) |
| "çapraz", "köşeden köşeye" | `type:'linear', from:'bottom-left', to:'top-right'` |
| "köşesi parlasın", "köşeden yayılsın" | `type:'radial', center:'bottom-left', axis:'z', radius:1.2` (köşeyi kelimeye göre seç) |
| "ortası parlasın", "merkezden dışa" | düz obje: `type:'radial', center:'center'`; hacimli obje: `type:'spherical', center:'center'` |
| "kenarları farklı renk", "çerçeve gibi" | `type:'edge'` |
| "etrafında dönsün", "gökkuşağı halkası", "hologram" | `type:'angular', axis:'y', center:'center'` |
| "üstü ışık alsın", "kar yağmış gibi", "tepesi aydınlık" | `type:'normal', direction:[0,1,0]` |
| "lekeli", "benekli", "yosunlu", "paslı", "nebula" | `type:'noise', scale:1.5–3` |
| "her yüz biraz farklı" | `type:'face'` |
| "çizgili", "şeritli" | `repeat:'repeat'` + `steps:2` (+ `offset`) |
| "dalga dalga", "gidip gelen" | `repeat:'mirror'` |

**Adım 3: Sertlik ve güç kelimeleri → spec.**

| Kullanıcı der ki | Spec |
|---|---|
| "yumuşak geçiş", "akışkan" | `ease:'smooth'` |
| "keskin", "çizgi film gibi", "basamaklı", "bantlı" | `steps:3–5` |
| "hafif", "az", "belli belirsiz" | `mode:'tint'`, `amount:0.3–0.5` |
| "rengini koru, sadece tonunu değiştir" | `mode:'tint'` |
| "güçlü", "tamamen" | `mode:'replace'`, `amount:1` |
| "parlasın", "ışık vursun" | `mode:'screen'`, `amount:0.25–0.5` (bunu ana gradientin üstüne ikinci katman olarak ekle) |
| "koyulaşsın", "gölgelensin" | `mode:'multiply'`, `amount:0.4–0.7` |
| "sadece yapraklara", "sadece mavi kısma" | `only:['#<o parçanın taban rengi>']` |
| "sadece üst yüzlere" | `where: ctx => ctx.worldNormal.y > 0.5` |
| "geçiş çabuk olsun" / "uzun sürsün" | `curve:0.6` / `curve:1.6`, ya da stop konumlarını kaydır |

**Adım 4: Renk adı → hex.** Her renk için üç ton var. Highlight stop'u için açığı, base için ortayı, shadow için koyuyu
kullan. Kullanıcı sadece iki renk söylerse ("turkuazdan mora") arasına **ton kaydırmalı bir ara stop** ekle (turkuaz →
mavi → mor). İki rengi asla gri/çamur bir ortadan geçirme.

| Renk | Koyu (shadow) | Orta (base) | Açık (highlight) |
|---|---|---|---|
| kırmızı | `#5a0b14` | `#d6283a` | `#ff7a7a` |
| bordo | `#3a0610` | `#7a1428` | `#c0405a` |
| turuncu | `#7a2e05` | `#f2731c` | `#ffb35c` |
| sarı | `#8a6300` | `#f5c518` | `#fff27a` |
| altın | `#7a4a00` | `#e0a21a` | `#ffe27a` |
| lime | `#2f5a0a` | `#7ccf1f` | `#d4ff6a` |
| yeşil | `#0f3b16` | `#2a8e28` | `#9be35a` |
| zümrüt | `#063a2a` | `#12a46c` | `#6ff0b8` |
| turkuaz / teal | `#08454a` | `#1fa5a8` | `#7cf0e6` |
| cyan | `#06506b` | `#19c3e6` | `#9ff4ff` |
| açık mavi / gök | `#1a4d8a` | `#4cb0ff` | `#c8eeff` |
| mavi | `#0d2a7a` | `#2f6fe0` | `#7fb5ff` |
| lacivert | `#0a1030` | `#1e2c6e` | `#4a5cb0` |
| mor | `#2a0b5a` | `#7a3fd8` | `#c39bff` |
| lila / eflatun | `#4a2a7a` | `#a07ae0` | `#e2d0ff` |
| pembe | `#7a1f4a` | `#ff6fae` | `#ffc4de` |
| magenta | `#5a0050` | `#e01ec0` | `#ff8af0` |
| kahverengi | `#3a1e10` | `#7a4a2a` | `#b98250` |
| bej / kum | `#6a523b` | `#c9ad80` | `#f0e4c8` |
| gri / taş | `#2a2c32` | `#6b6f7a` | `#b5b9c4` |
| gümüş | `#4a505a` | `#a8b0bc` | `#f0f4fa` |
| siyah | `#08080c` | `#1c1c24` | `#3a3a48` |
| beyaz | `#b8bcc8` | `#e8ecf4` | `#ffffff` |

**Adım 5: Tema / his kelimesi → hazır stop seti.** Kullanıcı bir his söylerse ("lav gibi", "galaksi") bunları kullan.
Bunlar preset değil, başlangıç noktası; modele göre yön ve tip sen seçersin.

| Tema | Stops (0 → 1) | Önerilen tip |
|---|---|---|
| gün batımı | `#2a0b5a` → `#d6285a` → `#ff8a3a` → `#ffe27a` | linear alttan üste |
| okyanus | `#061a3a` → `#0d4fa8` → `#1fa5a8` → `#9ff4ff` | linear alttan üste |
| galaksi | `#0a0820` → `#2a0b5a` → `#7a3fd8` → `#ff6fae` | noise + radial |
| lav | `#1a0806` → `#7a1405` → `#f2401c` → `#ffd23f` | noise veya normal (çatlakta emissive) |
| ateş | `#5a0b05` → `#f2401c` → `#ff9a1c` → `#fff27a` | linear alttan üste |
| buz | `#0d3a7a` → `#4cb0ff` → `#c8eeff` → `#ffffff` | normal yukarı veya spherical |
| zehir / toksik | `#1a2a05` → `#4a9a0a` → `#a4ff2a` → `#eaff9a` | noise |
| orman | `#0f3b16` → `#2a8e28` → `#7ccf1f` → `#d4ff6a` | linear alttan üste |
| altın / legendary | `#7a4a00` → `#c26a00` → `#ffd34d` → `#fff6c0` | spherical veya normal |
| şeker / candy | `#ff6fae` → `#ffc4de` → `#9ff4ff` → `#fff27a` | linear, `steps` ile şerit |
| neon / siber | `#0a0820` → `#e01ec0` → `#19c3e6` | angular veya edge + emissive |
| void / gölge | `#000000` → `#1a0a30` → `#5a1aa8` → `#d07bff` | edge (kenar parlak) |
| aurora | `#06506b` → `#12a46c` → `#7ccf1f` → `#c39bff` | linear soldan sağa + noise katmanı |
| gökkuşağı / secret | `#ff4fd8` → `#5fc4ff` → `#7cff6a` → `#ffd34d` → `#ff4fd8` | angular (ilk = son renk, dikiş olmaz) |
| ahşap | `#3a1e10` → `#7a4a2a` → `#c38148` | linear + `woodBeam` look |
| taş | `#201c19` → `#5c4832` → `#876b48` | normal yukarı, multiply |

Rarity renkleri (GFX ile aynı, tier gradientinde kullan): common `#9aa3b5/#5b6270`, uncommon `#7cff6a/#1f7a2a`,
rare `#5fc4ff/#1543a8`, epic `#d07bff/#5a1aa8`, legendary `#ffd34d/#c26a00`, mythic `#ff5f8f/#a8002f`, secret `#ffffff/#ff4fd8`.

**Adım 6: Kullanıcı sadece "gradientli olsun" derse, obje tipine göre varsayılan.**

| Obje | Varsayılan gradient |
|---|---|
| Tabela / panel / pano | radial, `center:'bottom-left'`, `axis:'z'`, açık → base → koyu ton kaymalı; look `softBevel`, `studs:'none'` |
| Ağaç / bitki / çalı | linear alttan üste, `mode:'tint'`, `amount:0.55`, `only:[yaprak rengi]` + `'light'` |
| Kristal / gem | spherical merkezden (içten parlama) + angular hafif katman (`amount:0.3`) |
| Kaya / uçurum | normal `[0,1,0]` multiply + `'light'`; üstte çim kapağı varsa noise |
| Pet / kürk | linear arka-alttan ön-üste (`from:'bottom-back'`, `to:'top-front'`) + göbek/yüze radial açık yama (`center:'bottom-front'`, `ease:'smooth'`) |
| Yumurta | linear alttan üste veya temaya göre noise/radial |
| Kılıç bıçağı | linear sapdan uca (koyu → açık), yüksek tier'da uca emissive |
| Coin / madalya | radial merkezden (açık merkez → koyu kenar) + `goldPiece` look |
| Sandık / kasa | linear alttan üste hafif (`amount:0.4`) + `'light'` |
| Mantar | şapkaya linear alttan üste + benekler için ayrı noise |
| Şişe / iksir sıvısı | linear alttan üste (dipte doygun → yüzeyde açık) |
| Bina / duvar | `'light'` + noise kir (`mode:'multiply'`, `amount:0.3`) |

**Adım 7: Spec'i insan diliyle geri oku.** Her gradient spec'inin yanına **tek cümlelik açıklama** yaz. Kullanıcı
böylece resim görmeden ne çıkacağını anlar ve konsepti onaylarken hatayı yakalar:

> *Sol alt köşede açık turkuaz parlıyor, ortaya doğru maviye dönüyor, sağ üst köşede koyu mora kararıyor. Geçiş yumuşak, yüzeyin tamamını boyuyor.*

**Örnekler: kullanıcının cümlesi → spec**

| Cümle | Spec |
|---|---|
| "tabela turkuazdan mora geçsin, köşesi parlasın" | `{type:'radial', center:'bottom-left', axis:'z', radius:1.2, ease:'smooth', stops:[[0,'#7cf0e6'],[0.4,'#1fa5a8'],[0.7,'#2f6fe0'],[1,'#2a0b5a']]}` |
| "ağacın yaprakları aşağıda koyu yeşil, tepede limon yeşili" | `{type:'linear', from:'bottom', to:'top', space:'part', mode:'tint', amount:0.6, only:['#2a8e28'], stops:[[0,'#0f3b16'],[0.55,'#2a8e28'],[1,'#d4ff6a']]}` |
| "kılıç lav gibi olsun" | bıçak: `{type:'linear', axis:'y', stops:[[0,'#1a0806'],[0.4,'#7a1405'],[0.8,'#f2401c'],[1,'#ffd23f']]}` + `{type:'noise', scale:3, mode:'screen', amount:0.35, stops:[[0,'#000000'],[1,'#ff9a1c']]}` + uçta emissive |
| "kristal hologram gibi dönen renkler" | `{type:'angular', axis:'y', center:'center', stops:[[0,'#ff4fd8'],[0.25,'#5fc4ff'],[0.5,'#7cff6a'],[0.75,'#ffd34d'],[1,'#ff4fd8']]}` |
| "kayanın üstü güneş alsın, altı karanlık" | `{type:'normal', direction:[0,1,0], mode:'multiply', amount:0.6, stops:[[0,'#3a3530'],[1,'#ffffff']]}` + `'light'` |
| "pet kedi turuncu, karnı krem" | gövde: `{type:'linear', from:'bottom-back', to:'top-front', stops:[[0,'#c66a1c'],[0.5,'#f2a33a'],[1,'#ffd27a']]}`; karın: `{type:'radial', center:'bottom-front', ease:'smooth', mode:'replace', amount:0.8, radius:0.35, stops:[[0,'#fff4dc'],[1,'#f2a33a']]}` |
| "çizgi film gibi gün batımı kulesi" | `{type:'linear', from:'bottom', to:'top', steps:4, stops:[[0,'#2a0b5a'],[0.35,'#d6285a'],[0.7,'#ff8a3a'],[1,'#ffe27a']]}` + look `toon` |
| "şeker kamışı gibi çizgili" | `{type:'linear', direction:[1,1,0], repeat:'repeat', steps:2, stops:[[0,'#ffffff'],[1,'#d6283a']]}` (çizgi sıklığını `curve` / spec tekrarlarıyla ayarla) |

### 5.6 Roblox malzemeleri

`k.robloxMaterial(name, {color, tile})`; `tile` = doku tekrarı başına stud. 22 preset:
`SmoothPlastic, Plastic, Neon, Metal, DiamondPlate, CorrodedMetal, Foil, Glass, Wood, WoodPlanks, Brick, Cobblestone,
Concrete, Slate, Granite, Marble, Pebble, Sand, Grass, Ice, Fabric, ForceField`.
`Neon`, `ForceField` emissive; `Glass`, `Ice`, `ForceField` yarı saydam. `k.part` dışındaki mesh'lerde `k.worldUV(mesh)` gerekir (ajan halleder).

### 5.7 PBR dokular (ajan kendisi yazar)

**A) Döşenebilir malzeme** (4096²'ye kadar): `k.pbrSurface(def, {size, repeat})`. `def` = `height`, `albedo`, `roughness`,
`metalness`, `emissive` fonksiyonları; `k.tex` (texlab) yapı taşları: `bricks, fbm, ridged, cells, ramp, mix, warp`.
4K harita seti: `npm run texture -- textures/<isim>.js --size 4096` → albedo, normal (OpenGL +Y), roughness, metalness,
AO, height, ORM, `material.json` (glTF + Roblox SurfaceAppearance eşlemesi).

**B) Modele özel boyama:** `await k.paint(mesh, {painter:{albedo(ctx,color), roughness(ctx), metalness(ctx), emissive(ctx), height(ctx), bump}})`.
`ctx` modeli bilir: `world`/`part` konum, `worldNormal`, `edge` (en yakın sert kenara stud), `edgeRel`, `modelY`
(0 alt → 1 üst), `ao` (`occlusion:true` ile), `s,t` (yüz içi konum), `noise`, `fbm`, `smooth`, `mix`, `rgb`.

Ne için: sadece gerçek kenarlarda aşınmış boya, altta kir/yosun, üst yüzlerde kar (`worldNormal.y`), girintide pas
(`ao`), tek yüzde parlayan rünler, lav çatlakları (Voronoi kenarları + emissive).

Doku sanatçısı kuralları: önce height, renk height/cavity/edge'den gelir; albedo'da ışık bake etme (30–240 sRGB);
roughness değişken (girinti pürüzlü, aşınmış kenar pürüzsüz); metalness 0 ya da 1; tekrarı domain warp + hücre id
varyasyonu ile kır; Roblox için 512–1024, satış/hero için 2K–4K.

Promptta doku tarif ederken: **height hikâyesi + renk kaynağı + roughness farkı + nerede aşınma/kir** yaz.

### 5.8 Rig ve animasyon

| Rig tipi | Ne zaman | Nasıl |
|---|---|---|
| Yok | Statik prop | — |
| Eklemli (rigid) | Robot, zırh, mekanizma, kapak | Parçalar `k.bone`'lara bağlanır, bükülmez |
| Skinned | Bükülen gövde: kuyruk, dokunaç, yosun, yumuşak gövde, organik uzuv | `k.skin(name, geo, mat, [bones], v => [[boneIndex,weight],…])`, vertex başına 1–4 etki |
| Morph | Yüz ifadesi, şişme | `morphTargetInfluences` track'i |

Animasyon: `k.clip(name, saniye, tracks)`; `k.track` (position/scale/quaternion/morph), `k.rotation` (Euler → quaternion),
`k.sample(node, prop, süre, fps, t => değer)` (matematiksel hareketi bake eder). Tam dönüşlerde ara örnek gerekir.

Promptta rig için ver: **kemik listesi ve hiyerarşisi** (Root → Spine → Head…), hangi mesh skinned, hangi parça hangi
kemiğe bağlı, eklem başına ≥ 3 edge loop. Klipler için: **isim, süre (sn), loop mu, ne hareket ediyor, genlik/karakter.**
Örnek: `Idle 2.0 s loop: Spine ±3° nefes, Tail1-3 faz kaymalı ±12° sallanma`.

Mevcut örnek projeler: `courier` (rigid zırh + ağırlıklı uzantı), `kelp` (sürekli zincir), MILO robot (13 kemik,
Idle/Walk/Wave), NORI yumuşak gövde (9 kemik, Sway/Curl), `megalodon-abyss`, `arachnid-venom`.

### 5.9 Roblox Highlight ve Edge Outline (SADECE İSTENİRSE)

- **Highlight:** `k.highlight(target, {FillColor:[r,g,b], FillTransparency, OutlineColor, OutlineTransparency, DepthMode:'AlwaysOnTop'|'Occluded'})`.
  `FillTransparency:1` = sadece outline. Ekstra: `outlineWidth` (3), `glow`, `glowColor`, `fillStyle` (`'solid'` vb.), `pulse:{speed, amount}`.
- **Edge Outline:** `k.edges(target, {color, thickness, creaseAngle, fill:false})`. Silüet + sert kenar çizgileri.
- Export'ta gerçek geometri olarak bake edilir (`_HighlightOutline`, `_HighlightFill`, `_EdgeLines`, `_EdgeSilhouette`),
  skinned parçalarda kemikle hareket eder. `npm run export -- <slug> lua` → Roblox'ta renk/aç-kapa/pulse kontrol eden
  `CodexOutline` script'i. `--highlights outline` fill'i atar, `--highlights none` sadece ayarları yazar.

### 5.10 Topoloji, optimize, LOD

| Kullanıcı der ki | Yapılacak | Promptta yaz |
|---|---|---|
| "optimize et", "hafiflet", "poly azalt" | Ajan **tarifte kendisi** azaltır: segment düşürür, gizli yüzleri siler, tekrarları instance eder | "Tarifte optimize et, hedef < N üçgen, `--quality` ile doğrula" |
| "akıllı topoloji" | Sitenin Smart Topology'si: `k.quality()` skor, `k.fixTopology()` Smart fix, Quads görünümü, `k.smartTopology(intent)` | intent ver: `auto`, `animation` (her yerde quad akışı), `subdivision` (%100 quad, şekil aynı), `game`/`print` (sadece temizlik) |
| "LOD", "LOD seviyeleri" | `k.lod({reduction, maxError})`, `--lod 0.5`, `--lod-chain` (LOD0–LOD3), `--cull` (küçük parçaları at) | "LOD0–LOD3 zinciri, uzak LOD'larda küçük parçaları ayıkla" |

- Kalite skoru 0–100 (A–F): quad oranı, n-gon fan, pole yeri, yoğunluk dengesi, üçgen kalitesi, manifold, skinned eklem
  başına ≥ 3 loop. Teslimde **≥ B** iste.
- Smart topology mesh'i sınıflar: deforming (skinned/morph) → quad akışı; organic → quad cap + relax; hard-surface →
  ek geometri yok, sadece bozuk üçgen temizliği.
- Quad'ları korumak gerekiyorsa: `npm run export -- <slug> obj --topology subdivision`.
- **Mühendislik (SIMP) topoloji optimizasyonu:** `k.topologyPart(name, {case:'cantilever'|'mbb'|'bridge'|'bracket'|'arch', volfrac:0.35, nelx, nely, size, thickness, mesher:'quad'|'extrude'})`.
  Braket, köprü, kemer gibi "malzemeyi optimum dağıt" parçaları için. GFX'te `blueprint` ile sun.
- Organik bükülen yüzeyler `k.quadSurface` veya halka döngüleriyle başlar; radyal segmentler 4'ün katı; eğrilik ve
  eklemlerde yoğunluk, düz yerlerde seyrek.

### 5.11 İkon paketi (SADECE İSTENİRSE)

~14.000 ikon/doku/efekt: `npm run assets -- "golden coin" --kind icon`. `k.iconBadge(name, 'Golden Coin', {size, depth})`
ikonu 3D rozete çevirir; `k.iconPlane` düz kesik kart; `k.decal` görüntüyü yüzeye yansıtır. Lisans: gvesster
paketleri ticari iş için tercih; RhosGFX sadece kullanıcının kendi oyunları; UI Icon Pack Catalog sadece referans.

### 5.12 Önizleme ışığı

Preset'ler: `studio` (varsayılan), `dramatic`, `soft`, `sunset`, `roblox`, `classic`. Manifest'te `"lighting": "roblox"`,
PNG'de `--light dramatic`. **Sadece görüntüleme ışığı**, GLB'ye ışık yazılmaz.

### 5.13 Parametreler (sağ panel)

Manifest `parameters` + `controls`: `{type:'color', label}` ya da `{type:'number', label, min, max, step}`. Promptta
**ayarlanabilir olmasını istediğin şeyleri listele**: renkler, adet (dal, boynuz, katman), boyut, gradient alt/üst.
Örnek: `stud-pine` → leaves, bark, tiers (2–6), width (4–12 stud), gradientBottom, gradientTop.

### 5.14 Export

| Format | Komut | İçerik |
|---|---|---|
| GLB | `npm run export -- <slug> glb` | Tek dosya: geometri, PBR, skin, kemik, tüm klipler, highlight/edge |
| glTF | `… gltf` | Aynısı, JSON |
| OBJ+MTL ZIP | `… obj` | Görünen poz, taban renk, quad korunabilir; rig/animasyon yok |
| STL | `… stl` | Sadece geometri (baskı) |
| Three.js JSON | `… json` | Three sahnesi + animasyon |
| PNG | `… png [--light preset]` | Ekran görüntüsü |
| Lua | `… lua` | CodexOutline (sadece highlight/edge varsa) |
| Azaltılmış | `… glb --ratio 0.6`, `--lod 0.5`, `--lod-chain` | Teslim varyantları |

### 5.15 GFX (sunum görselleri)

`npm run gfx -- <slug> --preset <isim>|all --title ".." --tag ..`. Sitede ✧ GFX Studio (G tuşu). 19 preset:

| Preset | Boyut | Ne için |
|---|---|---|
| `card` / `card-dark` / `card-color` | 1024² | Ürün kartı (açık / koyu / duotone) |
| `social` | 1080×1350 | Sosyal medya dikey |
| `cover` | 1920×1080 | Paket kapağı |
| `banner` | 1920×480 | Mağaza bannerı |
| `icon` / `icon-rarity` / `icon-minimal` | 1024² | Roblox ikon (gökyüzü patlaması / rarity çerçeve / pastel disk) |
| `thumbnail` / `thumbnail-sunset` / `thumbnail-night` | 1920×1080 | Roblox oyun küçük resmi |
| `showcase` | 1920×1080 | Simülatör vitrini (koyu ızgara) |
| `podium` | 1024² | Kürsü + spot ışık |
| `blueprint` | 1600×1200 | Mühendislik çizimi (ölçülü) |
| `halftone` | 1024² | Pop art |
| `turnaround` | 1600² | 4 görünüm (3/4, ön, yan, arka) |
| `sticker` | 1024² | Şeffaf + beyaz outline |
| `transparent` | 1024² | Şeffaf PNG |

- CLI alanları: `--title`, `--tag`, `--subtitle`, `--footer`, `--accent #hex`, `--angle three-quarter|iso|front|side|back`,
  `--rarity common|uncommon|rare|epic|legendary|mythic|secret` (açılar ayrıca: `top`, `low`, `hero`), `--width`, `--height`, `--light <preset>`. Sitede ayrıca `eyebrow`.
- Arka plan fotoğrafı: `--bg-image foto.jpg --bg-fit cover --bg-blur 8 --bg-darken 0.3`.
- Watermark: `--watermark "MyGame" --wm-position <9 konum> --wm-opacity --wm-size --wm-rotation --wm-tile --wm-image logo.png`.
- Video: `--video mp4|gif --fps 30 --clips "Run,Attack"|all --mode sequence|together --crossfade 0.3 --loops 2 --turntable 360`.
  Kadraj sabitlenmiştir (model kaymaz), seamless loop varsayılan.
- Model paketi satış seti: her ürüne `card`, + `cover`, `icon`, `thumbnail`, `turnaround`, 360° turntable MP4/GIF, hepsinde watermark.
- Sticker outline ve glow sadece istenirse (ya da preset sticker/halftone ise).

---

## 6. Stil dili ve referans tarifler

### 6.1 Ana stiller

| Stil | Nasıl kurulur | Look | Gradient |
|---|---|---|---|
| **Stud Nature / voxel stud** | `k.voxels` / `k.block`, her yüzde StudTrain | `'default'` veya `glowEdge` | Bölgeye renk gradienti + `'light'` |
| **Roblox Part** | `k.part`, üstte stud | — | İsteğe bağlı |
| **Stilize / cartoon** | `roundedBox`, `sphere`, `lathe`, `tube` + `k.paint` | `vinylToy`, `softBevel` | Kürk/gövde gradienti |
| **Low-poly** | düşük segment, `icosahedron`, flat shading | `'flat'` veya `toon` | `steps` ile bantlı |
| **Gerçekçi PBR** | `k.pbrSurface` / `painter` | — | Genelde yok; dokudan |
| **Neon / sci-fi** | `Neon` malzeme, emissive | `neonEdge` | angular/radial parlak |
| **Mühendislik** | `k.topologyPart` | — | — |

### 6.2 Simülatör pet (küp pet) — `projects/cube-pet.js`

- Gövde yuvarlak küp, en:boy:derinlik ≈ 1 : 0.9 : 0.9, köşe yarıçapı ≈ genişliğin %16'sı. Kafa = gövde (yüz önde).
- Gözler: yüz genişliğinin ≈ %32'si iki disk, üst yarıda, arada ≈ %8; beyaz halka, iris (tür rengi), göz bebeği, iki
  parlama (büyük sol üst, küçük sağ alt, hafif emissive). Gözlerin altında küçük koyu üçgen burun.
- Kulaklar türe göre: kedi = üst köşelerde kısa 4 kenarlı koni + açık iç kulak; tavşan = uzun yuvarlak levha; ayı = yuvarlak disk.
  Bacaklar: köşelerde gövde boyunun %18–22'si 4 küt bacak. Kuyruk: arkada küçük top.
- Renk: kürk gradienti (arka/alt gölge → base → üst-ön açık) + açık göbek/yüz yaması (alt-önden radial, smooth ease).
  Düşük rim, neredeyse vinyet yok.
- Tier'lar aynı mesh: ice (fasetli kristal kaplama, açık mavi), gold (sarı→turuncu), rainbow (angular), shadow/void (koyu + emissive rim).
  GFX: `showcase` / `icon-rarity`. Varsayılan statik.

### 6.3 Yumurta — `projects/sim-egg.js`

Ovoid, enine göre ≈ 1.3× uzun, en geniş yeri aşağıda (lathe, yarıçap × (1 − 0.18·t)), 32 segment. Temalar painter + ek
parçalarla: tech (paneller, parlayan çekirdek), ice (tabanda kristal parçaları), galaxy (indigo→mor gradient, fbm nebula,
yıldızlar, yörünge halkası), demon (boynuz, koyu faset, magenta çatlak), amethyst (kristal küme), angel (beyaz, altın
şerit, kanat), dragon (kırmızı pul, boynuz, kanat), nature (yeşil, sarmaşık, çiçek), candy (pembe çizgi, lolipop),
lava (koyu plaka + Voronoi emissive çatlak).

### 6.4 Alet ve silah

- **Kazma:** kalın hilal kafa (sap genişliğinin ≈ 2.4×'ü, uçlar aşağı kıvrık), ortada süs (gem/amblem/dişli), kısa kalın
  sap + 2–4 sargı, topuz. Temalar: void, galaxy, steampunk, nature, ruby, lava, candy, cosmic, angel.
- **Kılıç:** tek bıçak silüeti, tier renkleri, yüksek tier'da emissive kenar/uç.
- **Silah:** voxel veya low-poly, element varyantları. **Olta:** uzun ince; sapı küçük resimde okunacak kalınlıkta.
- Statik (animasyon yok).

### 6.5 Simülatör ürün dili (satan şey)

- **Tier merdiveni:** tek silüet, 8–15 tier: wood/stone/iron → gold/crystal → elemental (emissive kenar, daha büyük kafa,
  diken, kanat). Tek parametreli tarif + her tier'a tasarlanmış gradient/look.
- Sunum: koyu lacivert/mor üzerinde varyant sırası (`showcase`), beyazda ikon sayfası, büyük başlıklı kapak, turntable.

### 6.6 Doğa / hazine / pazar paketi kontrol listesi

Yuvarlak/çam/palmiye/dallı ağaç, çalı, çim öbeği, çiçek, mantar, çimen kapaklı kaya/uçurum, sandık (lacivert demir şerit
+ altın köşe blokları), kasa, fıçı, kütük, çit, bank, tabela, pazar tezgâhı (çizgili tente, meyve tepsisi), çeşme, örs,
çekiç, kazma, kürek, anahtar, coin, altın külçe, taç, kupa, gem, mıknatıs, elma, muz, armut, balkabağı, karpuz,
liderlik tablosu.

Stud Nature gramerinden: ahşap kiriş ≈ voxel başına 2 stud + oluk; taş voxel başına 1 stud, düşük stud kontrastı
(`studStrength` ~0.5); taş uçurumların üstünde 1 voxel yeşil çim katmanı (kendi rim'iyle).

### 6.7 Model paketi iş akışı

1. Tema + 20–100 ürün listesi. 2. Silüet başına bir parametreli tarif. 3. Paket boyunca aynı look + light gradient, ürün
başına gradient. 4. Kalite ≥ B. 5. Ürün başına GLB. 6. GFX: ürün başına card, cover, icon, thumbnail, turntable, watermark.

---

## 7. Görsel olmadan anlama: her şey için kelimeden spec'e

Kullanıcı **resim, çizim ya da referans vermez**. Sadece konuşur: "sevimli bir ejderha, biraz tombul, lav gibi parlasın,
kanat çırpsın". Senin işin bu cümleden Codex Design'ın anlayacağı **tam sayısal tarifi** çıkarmak. Referans görsel
isteme. Kullanıcı yine de görsel verirse önce onu kelimelerle tarif et, sonra bu bölümle spec'e çevir.

### 7.0 Yöntem (her istekte uygula)

1. **Cümleyi 8 eksene ayır:** Ne · Silüet/şekil · Boyut/oran · Stil · Yüzey/malzeme · Renk/gradient · Hareket · Sunum.
2. **Her kelimeyi sayıya çevir.** Bu bölümdeki tabloları kullan: "büyük" → stud, "sevimli" → oran, "parlak" → look değerleri, "yavaş" → saniye.
3. **Söylenmeyeni obje tipinin varsayılanıyla doldur** ([§7.10](#710-obje-tipine-göre-tam-varsayılan-paket)) ve "(öneri)" diye işaretle.
4. **Çelişkiyi çöz.** "Gerçekçi ama Roblox stud'lı" gibi çelişkide birini ana stil yap, diğerini detaya indir, tek cümleyle söyle.
5. **İnsan diliyle geri oku.** Her bölümün başına 1–2 cümlelik görsel tarif yaz. Kullanıcı resim görmeden ne çıkacağını anlasın.
6. **Sadece tek kritik soruyu sor.** Genelde şunlardan biri: statik mi, hareketli mi? Stud'lı mı, pürüzsüz mü? Nerede kullanılacak? Geri kalanı sen seç.

### 7.1 Boyut kelimeleri → stud

Ölçek referansı: Roblox karakteri ≈ **5 stud** boyunda (≈ 1.4 m), kapı ≈ 4×7 stud, oda ≈ 16×10×16 stud.

| Kelime | Stud (en büyük ölçü) | Örnek |
|---|---|---|
| minik, cep boyu | 1–2 | coin, anahtar, gem, meyve |
| küçük | 2–4 | pet, iksir, mantar, çiçek |
| el aleti boyu | 3–6 (uzunluk) | kılıç, kazma, çekiç, olta 8–10 |
| orta | 3–6 | sandık, fıçı, kasa, bank, tabela |
| insan boyu | 5–7 | NPC, heykel, çalı-ağaç arası |
| büyük | 8–16 | ağaç, araba, çeşme, tezgâh |
| çok büyük | 16–32 | ev, kule, gemi |
| dev, boss | 20–40 | boss yaratık, dev robot |

"Biraz büyük" ≈ ×1.25, "çok büyük" ≈ ×2, "biraz küçük" ≈ ×0.8. Her zaman **tam stud**'a yuvarla.

### 7.2 Oran ve karakter kelimeleri → ölçü

| Kelime | Ölçüye çeviri |
|---|---|
| sevimli, chibi, tatlı | kafa ≈ gövde boyu (1:1), göz yüz genişliğinin ≈ %32'si, kısa bacak (boyun %18–22'si), köşe yarıçapı genişliğin ≈ %16'sı, yuvarlak hatlar |
| tombul, tıknaz | en:boy ≈ 1 : 0.8–0.9, kısa kalın uzuvlar |
| ince, uzun, zarif | en:boy ≥ 1:3, ince uzuvlar, sivrilen uçlar |
| tehditkâr, korkutucu | dar kafa + geniş omuz/gövde (≈ 1 : 1.8), öne eğik duruş, sivri çıkıntılar (boynuz/diken), küçük göz |
| heybetli, güçlü | geniş taban, kalın gövde, büyük eller/pençeler, alçak ağırlık merkezi |
| hızlı, çevik | aerodinamik, arkaya süpürülmüş hatlar, ince bel, uzun bacak/kanat |
| hantal, ağır | geniş ve alçak, kalın plakalar, kısa bacak |
| asil, kraliyet | dikey simetri, taç/sivri tepe, ince altın detay |
| komik | abartılı tek özellik (dev kafa, minik kanat), asimetri |

### 7.3 Şekil kelimeleri → yapım yöntemi

| Kelime | Yöntem |
|---|---|
| yuvarlak, yumuşak, oyuncak gibi | `roundedBox`, `sphere`, `capsule` |
| köşeli, kübik, blok blok | `box`, `k.block`, `k.voxels` |
| piksel, pixel art, düz ikon gibi | `k.voxels({rows, palette, depth:1–2})` |
| dönel: vazo, şişe, yumurta, kupa, kase, mantar şapkası | `lathe` (profil noktaları) |
| kıvrımlı, boru, dal, kablo, kuyruk, kıvrık boynuz, sarmaşık | `tube` (eğri noktaları) |
| yassı kesik: bıçak, yaprak, logo, kanat zarı, tabela levhası | `extrude` (2D hat) |
| sivri, diken, boynuz | `cone`, `cylinder` (üst yarıçap 0) |
| fasetli, kristal, mücevher | düşük segmentli `cylinder` (6–8) veya `icosahedron` (detail 0–1) |
| delikli, oyuk, pencereli | `k.csg(..., 'subtract')` |
| organik, bükülen gövde, dokunaç | `k.quadSurface` + `k.skin` |
| çok tekrar eden parça (yaprak, pul, diken) | tek geometri + tekrar/instancing |

### 7.4 Stil kelimeleri → stil + look

| Kelime | Stil | Look | Not |
|---|---|---|---|
| Roblox tarzı, simülatör | stilize veya stud-voxel | `glowEdge` veya `vinylToy` | tasarlanmış gradient + `'light'` |
| Minecraft gibi, voxel | `k.voxels` | `'default'` | her yüzde `'train'` |
| lego, tuğla | `k.part` / `k.block` | `'default'` | `'train'` |
| low poly | düşük segment, flat shading | `'flat'` veya `toon` | `steps` gradient |
| cartoon, disney, sevimli | yuvarlak primitifler + `k.paint` | `vinylToy` / `softBevel` | yumuşak (`smooth`) gradient |
| anime, çizgi film | stilize | `toon` | `steps:3–4` |
| gerçekçi | modellenmiş detay + PBR | — | `k.pbrSurface` / painter |
| retro, 8-bit | voxel piksel art | `'flat'` | sınırlı palet (4–6 renk) |
| sci-fi, siber, futuristik | sert yüzey, paneller | `neonEdge` | `Neon` + emissive şeritler |
| fantastik, büyülü | organik + kristal | `glossy` | emissive gem/rün |
| korku, karanlık, lanetli | çarpık silüet | `worn` | koyu palet + emissive göz/çatlak |
| steampunk | dişli, perçin, boru | `worn` hafif | `Metal`, `Foil` (pirinç), `Wood` |
| minimal, temiz | az parça, büyük yüzeyler | `softBevel` | 2–3 renk |
| oyuncak, vinyl figür | yuvarlak | `vinylToy` | düşük rim |

### 7.5 Yüzey hissi kelimeleri → look değerleri

| Kelime | Look objesine ekle |
|---|---|
| parlak, cilalı, ıslak | `glossy` tabanı (`sheen:0.3–0.4`), malzeme `roughness 0.2–0.35` |
| mat | `rim:0.4, sheen:0`, `roughness 0.8–0.9` |
| sert kenarlı, keskin | `rim:0.8, rimSoftness:0.2, rimWidth:0.08` |
| yumuşak kenarlı | `softBevel` |
| kenarları parlasın | `glowEdge` (`rimMode:'gain'`). Outline/highlight değil. |
| neon kenar | `neonEdge` (`emissiveRim:0.8`) |
| eski, yıpranmış | `worn` (`edgeNoise:0.9, grime:0.3`) |
| kirli, çamurlu | `grime:0.4–0.6, grimeHeight:0.35` |
| tozlu | `speckle:0.06, lift:0.08, saturation:0.85` |
| pastel | `pastel` |
| canlı, doygun | `saturation:1.15–1.3` |
| soluk, solgun | `saturation:0.75–0.85, lift:0.05` |
| karanlık, kasvetli | `brightness:0.8, contrast:1.1, vignette:0.3` |
| derinlikli, hacimli | `ao:0.6–0.7, vignette:0.2` + `'light'` gradient |
| düz, gölgesiz | `'flat'` |
| ahşap kalas gibi | `woodBeam` + `studScale:2` |

### 7.6 Malzeme kelimeleri → malzeme / doku

| Kelime | Codex Design karşılığı |
|---|---|
| plastik | `Plastic` / `SmoothPlastic` |
| ahşap, tahta | `Wood` / `WoodPlanks` veya `woodBeam` look + sıcak ahşap paleti |
| taş | `Slate` / `Cobblestone` / `Granite` veya `stoneBlock` look (`studStrength:0.5`) |
| tuğla, beton, mermer, kum, çim | `Brick`, `Concrete`, `Marble`, `Sand`, `Grass` |
| metal, çelik | `Metal`; `metalness:1, roughness:0.3–0.5` |
| paslı metal | `CorrodedMetal` veya painter: girintide (`ao`) pas, kenarda parlak metal |
| altın | `goldPiece` look, `metalness:1`, `#e0a21a` tabanı |
| gümüş, krom | `metalness:1, roughness:0.15–0.3`, `#a8b0bc` |
| pirinç, bakır | `Foil` veya `metalness:1`, `#c08a3a` / `#b8643a` |
| elmas plaka, endüstriyel zemin | `DiamondPlate` |
| cam, şeffaf | `Glass` veya `MeshPhysicalMaterial` (transmission) |
| buz | `Ice` + buz paleti, normal yukarı gradient |
| kristal, mücevher | fasetli geometri + `glossy` + spherical gradient + hafif emissive |
| kumaş, kadife, yün | `Fabric`, `roughness:0.9`, `sheen` hafif |
| neon, ışık tüpü | `Neon` (emissive) |
| enerji kalkanı, büyü bariyeri | `ForceField` |
| lav, magma | painter: koyu plaka + Voronoi kenarlarında emissive turuncu çatlak |
| kar örtüsü | painter / gradient `where: ctx => ctx.worldNormal.y > 0.5` beyaz |
| yosun | noise gradient + `where` üst yüzler, yeşil |
| deri, pul, kabuk | painter height (hücre/pul deseni) + roughness farkı |
| gerçekçi taş duvar / tuğla / kabuk (4K) | `k.pbrSurface` tarifi + `npm run texture -- … --size 4096` |

### 7.7 Hareket kelimeleri → klip

Animasyon **sadece istenirse** ya da obje hareket etmek için varsa (karakter, yaratık, mekanizma). Her klip için isim,
süre, loop ve hareket yaz.

| Kelime | Klip | Süre | Hareket (başlangıç değerleri) |
|---|---|---|---|
| bekleme, nefes, idle | `Idle` | 2–3 s, loop | Spine ±2–4°, gövde scale 1→1.02, kafa hafif eğilme |
| yürüme | `Walk` | 0.8–1.2 s, loop | bacak ±25–35°, karşı kol/bacak, gövde ±0.03 m inip kalkma |
| koşma | `Run` | 0.5–0.7 s, loop | bacak ±45°, öne eğik 10°, daha büyük zıplama |
| zıplama | `Jump` | 0.6–1 s | çömelme %20 → kalkış → havada → iniş squash |
| sevinç, mutlu | `Happy` | 1 s | iki küçük zıplama + kuyruk/kulak hızlı sallanma |
| saldırı, vuruş | `Attack` | 0.6–1 s | %30 hazırlık (geri çekil), %15 vuruş (hızlı), %55 toparlanma |
| hasar alma | `Hit` | 0.3–0.4 s | geri sarsılma 10–15°, geri dönüş |
| ölüm | `Death` | 1–1.5 s | çökme, loop değil |
| el sallama | `Wave` | 1.5 s | kol 120° kalkık, el ±30° 3 kez |
| kuyruk sallama | (Idle içinde) | 1–2 s, loop | Tail1→3 faz kaymalı ±10–20°, uca doğru artan |
| kanat çırpma, uçma | `Fly` | 0.4–0.6 s, loop | kanat ±35–50°, gövde ±0.05 m |
| yüzme | `Swim` | 1.2–2 s, loop | gövde boyunca S-dalgası, kuyrukta en büyük |
| süzülme, havada durma | `Hover` | 2–4 s, loop | y ±0.1–0.2 m sinüs (pickup / büyülü objede, istenirse) |
| açılma (sandık, kapı) | `Open` | 0.8–1.2 s | kapak 0 → 100–110°, sonda küçük sekme |
| dönme (pickup) | `Spin` | 2–4 s, loop | Y 360°, ara örneklerle (quaternion çökmesin) |

Hareket karakteri kelimeleri:

| Kelime | Uygula |
|---|---|
| ağır, hantal | süre ×1.4, genlik küçük, `ease-in-out`, geç başlayan ağır uzuvlar |
| enerjik, hiperaktif | süre ×0.7, overshoot (hedefi %10 aşıp dön) |
| sevimli, lastik gibi | squash & stretch (scale 0.92 ↔ 1.08), zıplamalı |
| mekanik, robotik | lineer geçiş, duraklamalı (hold) kareler, keskin dönüşler |
| süzülen, rüya gibi | sinüs, uzun süre, faz kaymalı ikincil hareket |
| yırtıcı, tehditkâr | yavaş hazırlık + çok hızlı vuruş, kafa sabit gövde hareketli |

Rig'i hareketten çıkar:
- Parçalar sadece dönüyor/kayıyorsa → **eklemli** (rigid parçalar kemiklere bağlı).
- Gövde bükülüyorsa (kuyruk, yılan, dokunaç, balık, yumuşak gövde) → **skinned** zincir, eklem başına ≥ 3 edge loop.
- Kemik şablonları: 4 bacaklı pet → `Root, Body, Head, LegFL, LegFR, LegBL, LegBR, Tail1, Tail2`; iki ayaklı →
  `Root, Hips, Spine, Chest, Head, UpperArmL/R, LowerArmL/R, UpperLegL/R, LowerLegL/R`; yılan → `Seg1…Seg8`; balık →
  `Spine1…Spine4, FinL, FinR, Tail`; kuş/ejderha → iki ayaklı + `WingL1/2, WingR1/2, Tail1…3`.

### 7.8 Efekt ve "parlasın" kelimesinin anlamı

"Parlasın" üç farklı şey olabilir. Bağlamdan seç, emin değilsen tek satırda sor:

| Kullanıcının kastı | Belirti | Codex Design |
|---|---|---|
| Obje **içten ışık saçıyor** | lav, neon, büyü, enerji, göz, kristal çekirdek | `emissive` / `Neon` / painter `emissive` |
| **Kenarları** parlıyor | "kenarları parlak", "Roblox simülatör gibi" | look `glowEdge` |
| Seçilmiş gibi **etrafı** parlıyor | "seçili gibi", "hover", "outline glow" | `k.highlight` (istendi sayılır) |
| Yüzeyde **ışık yansıması** | "cilalı", "ıslak", "parlak plastik" | `glossy` / `sheen` |

"Çizgi", "kontur", "siyah kenar çizgisi" → `k.edges`. "İkon/amblem koy" → ikon paketi (istendiği için).

### 7.9 Sunum, ışık ve detay kelimeleri

| Kelime | Karşılık |
|---|---|
| mağaza kartı, ürün görseli | GFX `card` / `card-dark` |
| Roblox ikonu | `icon` (rarity varsa `icon-rarity`) |
| oyun kapağı, thumbnail | `thumbnail` / `-sunset` / `-night` |
| karanlık vitrin, simülatör tanıtım | `showcase` |
| teknik çizim | `blueprint` |
| dört taraftan göster | `turnaround` |
| şeffaf arka plan | `transparent` (outline'lı ise `sticker`) |
| dönen video, turntable | `--video mp4 --turntable 360` |
| dramatik ışık / yumuşak ışık / gün batımı / Roblox gündüzü | `lighting`: `dramatic` / `soft` / `sunset` / `roblox` |
| sade, basit | az parça, < 1.5k üçgen |
| detaylı | 5–15k üçgen, ikincil detaylar modellenir |
| mobil uyumlu | < 5k üçgen, atlas 1024 |
| vitrin, hero | ≤ 20k üçgen/mesh, 2K doku |
| baskı alacağım | STL, kapalı geometri, `smartTopology('print')` |

### 7.10 Obje tipine göre tam varsayılan paket

Kullanıcı sadece "bir X yap" derse bu satırı kullan. Söylediği her şey bunun üzerine yazılır.

| Obje | Boyut (stud) | Yöntem | Look | Gradient | Hareket | GFX |
|---|---|---|---|---|---|---|
| Ağaç | 8×14×8 | `k.voxels` taç + gövde | `'default'` | yaprağa linear tint + `'light'` | yok | card |
| Kaya / uçurum | 6×4×6 | `k.voxels`, çim kapağı | `stoneBlock` | normal yukarı multiply + `'light'` | yok | card |
| Çiçek / mantar | 2×3×2 | `lathe` + `tube` | `softBevel` | şapka/taç linear | yok | icon |
| Sandık | 4×3×3 | `k.block` parçalar | `woodBeam` + metal şerit | hafif linear + `'light'` | yok (açılma istenirse) | card |
| Coin / madalya | 2×2×0.5 | `cylinder` / `extrude` | `goldPiece` | radial merkezden | yok | icon |
| Gem / kristal | 1.5×2×1.5 | fasetli `cylinder` / `icosahedron` | `glossy` | spherical + angular hafif | yok | icon-rarity |
| Tabela | 6×4×0.5 | `k.block` levha + direk | `softBevel` | köşeden radial, `studs:'none'` | yok | card |
| Kılıç | 1×5×0.3 | `extrude` bıçak + kabza | `glossy` / `glowEdge` | saptan uca linear | yok | icon |
| Kazma | 3×4×0.6 | hilal `extrude` + sap | `glowEdge` | kafaya tema gradienti | yok | icon |
| İksir | 1.5×2.5×1.5 | `lathe` şişe + sıvı | `glossy` | sıvıya linear alttan üste | yok | icon |
| Pet | 2×2×2 | `roundedBox` + göz/kulak/bacak | `vinylToy` | kürk linear + göbek radial | yok (istenirse Idle/Walk/Happy) | icon |
| Yumurta | 2×2.6×2 | `lathe` 32 segment | `glossy` | tema (noise/radial/linear) | yok | icon-rarity |
| Bina / ev | 16×14×16 | `k.part` / `k.block` | `'default'` | `'light'` + noise kir | yok | cover |
| Araç | 6×3×10 | `k.block` + `cylinder` tekerlek | `glossy` | gövdeye linear | yok (istenirse tekerlek dönüşü) | thumbnail |
| Robot / mekanizma | 4×6×3 | parçalı, eklemli rig | `glossy` / `worn` | paneller linear | istenirse Idle/Walk | showcase |
| Yaratık / boss | 12×10×16 | organik + skinned | tema | tema | Idle + istenen | thumbnail |

### 7.11 Hızlı sözlük

Kullanıcının kelimesini bu tabloyla teknik dile çevir:

| Kullanıcı der ki | Promptta yaz |
|---|---|
| "stud'lı", "lego gibi", "Roblox tuğla" | StudTrain `'train'`; her yüz ise `k.voxels`/`k.block`, sadece üst ise `k.part` |
| "voxel", "minecraft gibi", "kübik" | `k.voxels` (fill/cells/rows), 1 voxel = 1 stud |
| "parlak kenar", "kenarları parlasın" | look `rimMode:'gain'` (glowEdge) — highlight değil |
| "outline", "kontur", "siyah çizgi" | `k.edges` (istendiği için) |
| "seçili gibi parlasın", "highlight" | `k.highlight` |
| "neon", "ışık saçsın" | `Neon` malzeme veya `emissive` / `emissiveRim` |
| "gradient olsun", "renk geçişi" | §5.5-B spec'i: type, stops (3–4), from/to veya center, mode |
| "gölgeli", "derinlikli" | look (rim+vinyet+AO) + `'light'` gradient |
| "düz renk", "flat" | look `'flat'`, gradient yok |
| "çizgi film", "toon" | toon look objesi (`posterize`) + `steps` gradient |
| "eski", "aşınmış", "paslı" | `worn` look + painter (kenarda aşınma, `ao`'da pas) |
| "gerçekçi doku", "PBR" | `k.pbrSurface` tarifi (height/albedo/roughness hikâyesi) |
| "4K doku" | `npm run texture -- textures/<isim>.js --size 4096` |
| "hareket etsin", "animasyon" | klip listesi (isim, süre, loop, hareket) |
| "bükülsün", "kuyruk sallansın" | skinned mesh + kemik zinciri |
| "hafif olsun", "optimize" | tarifte optimize, üçgen hedefi |
| "akıllı topoloji", "quad" | `k.smartTopology(intent)`, skor ≥ B |
| "LOD" | `--lod-chain` |
| "Roblox'a atacağım" | tam stud, Y yukarı, taban pivot, mesh başına ≤ 20k üçgen, atlas 1024, GLB |
| "3D baskı" | STL, `smartTopology('print')`, kapalı (manifold) geometri |
| "Blender'da düzenleyeceğim" | OBJ `--topology subdivision` (quad'lı) + GLB |
| "kart", "ikon", "thumbnail", "kapak" | ilgili GFX preset'i |
| "satacağım", "paket" | §6.7 akışı + watermark |
| "rarity", "legendary" | GFX `rarity` + tier gradienti |
| "ayarlanabilir olsun" | manifest parametreleri + controls |

---

## 8. Konsept çıktı formatı

Kullanıcı "konsept hazırla" dediğinde **bu formatta** cevap ver. 2–3 varyasyon (A sade / B detaylı / C farklı stil) öner;
kullanıcı seçince §9'a geç.

```markdown
## Konsept: <İsim> (`<slug>`)

**Tek cümle:** <ne olduğu, nerede kullanılacağı>
**Nasıl görünecek (insan dilinde):** <3–4 cümle: uzaktan silüet, renkler nerede açık/koyu, yüzey hissi, varsa hareketi.
Resim görmeden canlandırılabilecek kadar somut.>
**Ruh hâli / anahtar kelimeler:** <3–5 kelime>
**Kullanıcının kelimeleri → çeviri:** <"tombul" → en:boy 1:0.85, "lav gibi" → lav paleti + emissive çatlak, …>
**Kullanım:** Roblox oyunu | model paketi | GFX | baskı | web
**Hareket:** statik | animasyonlu (<neden hareket etmeli>)

### Silüet
- Uzaktan tanınan şey: <tek cümle>
- Oranlar: <örn. büyük kafa : küçük gövde ≈ 1 : 0.8>
- Boyut: <W×H×D stud> (≈ <metre>)

### Parçalar
| Parça | Şekil / yöntem | Boyut | Renk |
|---|---|---|---|
| ... | roundedBox / voxels / lathe / tube / extrude ... | ... | #hex |

### Yüzey ve renk
- Stil: <§6.1'den>
- Look: <'default' | 'flat' | obje adı + değişiklik>
- Stud: <yok | train | train-mixed ...>
- Palet: base #.., shade #.., light #.., accent #..
- Gradientler: <her biri için: hedef parça, type, yön, 3–4 stop, mode>
- Doku: <yok | PBR/painter hikâyesi>

### (Animasyonluysa) Rig ve hareket
- Rig tipi, kemik zinciri
- Klipler: isim · süre · loop · hareket

### Varyasyonlar
- **A – <isim>:** <fark>
- **B – <isim>:** <fark>
- **C – <isim>:** <fark>

**Öneri:** <hangisi ve neden, tek cümle>
**Açık soru (varsa):** <tek kritik soru>
```

---

## 9. Model promptu çıktı formatı (Codex Design'a verilecek)

Kullanıcı "model promptu hazırla" dediğinde **tek bir kod bloğu** içinde aşağıdaki şablonu doldur. Boş bölüm bırakma;
kullanmayacağın özelliğe açıkça "yok" yaz (ajan böylece kendiliğinden eklemez). Teknik değerleri §5'teki gerçek
isimlerle yaz.

### 9.1 Şablon

````markdown
Codex Design 3D ile aşağıdaki modeli üret. docs/TRAINING.md ve ilgili Train/*/TRAIN.md kurallarına uy.

## 0. Görsel tarif (niyet)
<4–6 cümle, insan dilinde: modelin uzaktan silüeti, ana parçaları, renklerin nerede açık/koyu olduğu, yüzey hissi
(mat/parlak/yıpranmış), varsa nasıl hareket ettiği. Aşağıdaki sayılar bu tarifi uygular. Çelişki olursa bu tarif kazanır.>

## 1. Kimlik
- Slug: `<slug>` → projects/<slug>.js + projects/<slug>.json
- Manifest name: "<BÜYÜK İSİM / kısa açıklama>"
- Ne: <tek cümle>
- Kullanım: <Roblox oyunu / paket / GFX / baskı>
- Referans: <varsa: projects/<benzer>.js, Train klasörü, export dosyası>

## 2. Ölçü ve yön
- Toplam boyut: <W×H×D stud> (1 stud = 0.28 m)
- Y yukarı, ön +Z, pivot taban merkezi
- Simetri: <simetrik X ekseninde | asimetrik>

## 3. Parçalar ve yapım yöntemi (benzersiz isimlerle)
| İsim | Yöntem | Boyut / konum | Taban renk | Not |
|---|---|---|---|---|
| Body | k.voxels({fill}) / k.block / k.mesh('roundedBox',…) / lathe … | … | #… | … |
| … | … | … | … | … |
- Silüet önceliği: <uzaktan okunması gereken detay>
- Detay seviyesi: <hangi detay modellenecek, hangisi dokuyla>

## 4. Yüzey
- Look: <'default' | 'flat' | { …obje… }>
- Stud: <'none' | 'train' | 'train-mixed'>, studStrength <..>, studScale <..>
- Roblox malzemesi: <yok | Parça → Malzeme>
- PBR / painter: <yok | k.pbrSurface veya painter tarifi: height, albedo kaynağı, roughness, metalness, emissive, nerede aşınma/kir>
- AO: <voxel ise otomatik | k.paint occlusion:true>
- Atlas: pxPerStud <32>, maxAtlas <1024 Roblox | 2048>

## 5. Gradientler (sırayla uygulanır)
1. Hedef `<Parça>`: { type:'…', from/to|center|direction:…, space:'part', mode:'…', amount:…, stops:[[0,'#…'],[…],[1,'#…']], only:[…] }
   → <bir cümle: nerede açık, nerede koyu, geçiş nasıl>

2. …
3. Model ışığı: k.gradient('Asset', { mode:'light', bottom:<..>, top:<..> }) | yok

## 6. Rig ve animasyon
- Rig: <yok — statik prop, klip ekleme | eklemli | skinned>
- Kemikler: <Root → Spine → Head; Tail1 → Tail2 → Tail3 …, konumlar>
- Skinned mesh'ler ve ağırlık mantığı: <örn. kuyruk boyunca lineer, eklemde ≥3 loop>
- Klipler:
  | Klip | Süre | Loop | Hareket |
  |---|---|---|---|
  | Idle | 2.0 s | evet | … |

## 7. Efektler
- Highlight: <yok | k.highlight('<Parça>', {FillColor:[..], FillTransparency:.., OutlineColor:[..]})>
- Edge Outline: <yok | k.edges('<Parça>', {color:'#000000', thickness:2})>
- Glow / emissive: <yok | hangi parça, emissiveIntensity>
- İkon paketi: <yok | sorgu + yer>

## 8. Parametreler (sağ panel)
| Anahtar | Tip | Varsayılan | Aralık |
|---|---|---|---|
| bodyColor | color | #… | — |
| count | number | 4 | 2–8, step 1 |

## 9. Teknik bütçe ve topoloji
- Üçgen hedefi: << N toplam / mesh başına ≤ 20k>
- Optimize: <yok | tarifte optimize et>
- Topoloji: <normal | k.smartTopology('<intent>')>, `npm run inspect -- <slug> --quality` ≥ B
- LOD: <yok | --lod-chain>

## 10. Önizleme ve teslim
- Işık: manifest "lighting": "<studio|dramatic|soft|sunset|roblox|classic>"
- `npm run preview -- <slug>` ile aç, kendin bak
- Export: <glb, png, …> (`npm run export -- <slug> glb`)
- GFX: `npm run gfx -- <slug> --preset <..> --title "<..>" --tag <..>` [+ rarity, watermark, video]
- Manifest "gfx": { "preset": "<..>", "title": "<..>", "tag": "<..>" }

## 11. Yapma
- <istenmeyen şeyler: highlight yok, animasyon yok, ikon yok, Kek stud yok, düz renk bırakma …>

## 12. Kabul kriterleri
- [ ] Silüet <..> uzaktan okunuyor
- [ ] Gradientler <..> görünür, düz renk yüzey yok
- [ ] Kalite skoru ≥ B, üçgen < N
- [ ] (animasyonluysa) tüm klipler GLB'de oynuyor
- [ ] Önizleme URL'si + export dosya linkleri verildi
````

### 9.2 Kalite kontrol (promptu vermeden önce kendin kontrol et)

- [ ] Slug küçük harf + tire, benzersiz.
- [ ] Tüm boyutlar tam stud.
- [ ] Her renk hex.
- [ ] Look string ise sadece `'default'` veya `'flat'`; değilse obje.
- [ ] Stud ise `'train'`/`'train-mixed'` (Kek istenmediyse).
- [ ] Renkli her parçanın tasarlanmış gradienti var (kullanıcı düz istemediyse); 3–4 stop, ton kayması, kontrast ≥ 2× (küçük) / ~1.5× (büyük panel).
- [ ] Statik prop'ta klip yok; "Rig: yok" yazıyor.
- [ ] Highlight/outline/glow/ikon sadece istendiyse var, yoksa "yok" yazıyor.
- [ ] "Optimize", "akıllı topoloji", "LOD" doğru araca eşlendi.
- [ ] Export formatı ihtiyaçla uyumlu (Roblox → GLB, baskı → STL, Blender → OBJ quad).
- [ ] Motorun yapamadığı bir şey istenmiyor (§2).
- [ ] "0. Görsel tarif" var ve sayılarla çelişmiyor. Kullanıcının her sıfatı (§7) bir sayıya çevrildi.
- [ ] Her gradientin yanında bir cümlelik "nasıl görünecek" açıklaması var.

### 9.3 Revizyon promptu

```text
Codex Design 3D: `<slug>` modelini revize et. Diğer her şey aynı kalsın.
- Değişiklik 1: <parça> <ne> (<eski değer> → <yeni değer>)
- Değişiklik 2: …
Sonra: inspect --quality, önizlemeyi yenile, <glb/png/gfx> tekrar export et.
```

---

## 10. Tam örnek (konsept → model promptu)

**Kullanıcı:** "Roblox madencilik oyunum için kristal cevher konsepti hazırla."

**AI konsept (kısaltılmış):** Crystal Ore (`crystal-ore`) · statik · 6×5×6 stud · gri voxel taş taban, üstünden 5 eğik
fasetli kristal · A: tek renk mor, B: mor + çimen kapağı, C: secret tier gökkuşağı angular. Öneri: B.

**Kullanıcı:** "B olsun, model promptunu hazırla."

**AI model promptu:**

````markdown
Codex Design 3D ile aşağıdaki modeli üret. docs/TRAINING.md ve ilgili Train/*/TRAIN.md kurallarına uy.

## 0. Görsel tarif (niyet)
Alçak, basamaklı, kahverengi-gri bir voxel kaya. Üstünde kenarlara doğru dağılan bir çimen kapağı var. Kayanın
üstünden yelpaze gibi açılan beş sivri, altıgen kesitli mor kristal çıkıyor; en büyüğü ortada ve dik, diğerleri
dışa eğik. Kristaller dipte koyu mor, uçlarda pembeye açılıyor, yüzeyleri cilalı ve üst yüzleri hafif parlıyor.
Taş mat ve üstten ışık almış. İkon boyutunda bile kristaller okunuyor.

## 1. Kimlik
- Slug: `crystal-ore` → projects/crystal-ore.js + projects/crystal-ore.json
- Manifest name: "CRYSTAL ORE / voxel stone + faceted crystals"
- Ne: Madencilik simülatöründe kazılabilir mor kristal cevheri.
- Kullanım: Roblox oyunu
- Referans: projects/stud-pine.js (voxel + gradient + light), Train/StudveGradientVideo (gem = pürüzsüz fasetli)

## 2. Ölçü ve yön
- Toplam boyut: 6×5×6 stud
- Y yukarı, ön +Z, pivot taban merkezi
- Simetri: asimetrik (kristaller farklı açılarda)

## 3. Parçalar ve yapım yöntemi
| İsim | Yöntem | Boyut / konum | Taban renk | Not |
|---|---|---|---|---|
| Rock | k.voxels({size:[6,2,6], fill}) | taban, köşeler 1 voxel kırpılmış basamaklı | #5c4832 | düzensiz üst yüz |
| GrassCap | Rock'un üst katmanında 1 voxel renk | Rock üstü, kenarlarda kesintili | #2b8c27 | kendi rim'i |
| Crystal1..5 | k.mesh('cylinder',[0, r, h, 6]) altıgen sivri + k.paint | h 2–3.5 stud, r 0.4–0.7 stud, 10–35° eğik | #8a3ffc | en büyüğü merkezde |

- Silüet önceliği: tepeden yelpaze gibi açılan sivri kristaller.
- Detay: kristal fasetleri geometriyle; taş kırıkları voxel basamaklarıyla.

## 4. Yüzey
- Look Rock: { rim:0.6, rimSaturate:0.4, rimLighten:0.45, vignette:0.18, ao:0.6 }
- Look Crystal: { rim:0.75, rimSaturate:1.3, rimLighten:0.4, glow:0.15, sheen:0.3, sheenDir:[1,1,0], sheenOffset:0.55, sheenWidth:0.1 }
- Stud: Rock 'train', studStrength 0.5; Crystal 'none'
- Roblox malzemesi: yok
- PBR / painter: yok
- AO: voxel otomatik; kristaller k.paint occlusion:true
- Atlas: pxPerStud 32, maxAtlas 1024

## 5. Gradientler
1. Crystal1..5: { type:'linear', from:'bottom', to:'top', space:'part', mode:'replace', stops:[[0,'#3a0f7a'],[0.5,'#8a3ffc'],[1,'#ff8ad8']] }
   → Her kristal dipte koyu mor, ortada canlı mor, ucunda pembe.
2. Crystal1..5: { type:'normal', direction:[0,1,0], mode:'screen', amount:0.25, stops:[[0,'#000000'],[1,'#c9b8ff']] }
   → Yukarı bakan fasetler hafif lila parlıyor.
3. Rock: { type:'normal', direction:[0,1,0], mode:'multiply', amount:0.5, only:['#5c4832'], stops:[[0,'#201c19'],[1,'#ffffff']] }
   → Taşın üstü aydınlık, yanları ve altı koyu.
4. GrassCap: { type:'noise', scale:2, mode:'tint', amount:0.5, only:['#2b8c27'], stops:[[0,'#103b16'],[1,'#46c938']] }
   → Çimen kapağında koyu ve açık yeşil lekeler.
5. Model ışığı: k.gradient('Asset', { mode:'light', bottom:0.5, top:1.15 })
   → Tüm model aşağıda biraz karanlık, yukarıda aydınlık.

## 6. Rig ve animasyon
- Rig: yok — statik prop, klip ekleme.

## 7. Efektler
- Highlight: yok
- Edge Outline: yok
- Glow / emissive: kristal uçlarında hafif emissive (emissiveIntensity 0.3), glow efekti yok
- İkon paketi: yok

## 8. Parametreler
| Anahtar | Tip | Varsayılan | Aralık |
|---|---|---|---|
| crystal | color | #8a3ffc | — |
| crystalLight | color | #ff8ad8 | — |
| rock | color | #5c4832 | — |
| count | number | 5 | 3–7, step 1 |
| grass | number | 1 | 0–1, step 1 (çimen kapağı aç/kapa) |

## 9. Teknik bütçe ve topoloji
- Üçgen hedefi: < 3.000
- Optimize: tarifte (kristal radyal segment 6)
- Topoloji: normal; `npm run inspect -- crystal-ore --quality` ≥ B
- LOD: yok

## 10. Önizleme ve teslim
- Işık: "lighting": "roblox"
- `npm run preview -- crystal-ore`
- Export: glb, png
- GFX: `npm run gfx -- crystal-ore --preset icon --title "Crystal Ore" --tag ORE` ve `--preset card`
- Manifest "gfx": { "preset": "icon", "title": "Crystal Ore", "tag": "ORE" }

## 11. Yapma
- Highlight, outline, glow efekti yok. Animasyon yok. İkon yok. Kek stud yok. Kristalleri düz renk bırakma.

## 12. Kabul kriterleri
- [ ] Kristaller ikon boyutunda okunuyor
- [ ] Kristal gradienti koyu mor → pembe görünür; taşta üstten ışık var
- [ ] Kalite ≥ B, üçgen < 3k
- [ ] Önizleme URL'si + exports/crystal-ore.glb + GFX linkleri verildi
````

---

## 11. Kullanıcı için: bu dosya nasıl kullanılır

1. Bu dosyayı (PROMPT.md) herhangi bir AI sohbetine yükle ya da yapıştır.
2. De ki: **"Bu dosyayı oku. Bana <fikir> için konsept hazırla."** → 2–3 varyasyonlu konsept gelir. Resim vermene
   gerek yok, kendi kelimelerinle anlat ("tombul, lav gibi parlayan, kanat çırpan ejderha"). AI her kelimeyi
   boyuta, renge, look'a ve harekete çevirir.
3. Birini seç: **"B olsun, model promptunu hazırla."** → tek blok prompt gelir.
4. O bloğu Codex Design sohbetine yapıştır. Model üretilir, önizleme açılır, dosyalar `exports/` klasörüne gelir.
5. Değişiklik için: **"Revizyon promptu yaz: kristalleri %20 uzat, rengi turkuaz yap."**

Daha derin API: [docs/AUTHORING.md](docs/AUTHORING.md) · eğitim kuralları: [docs/TRAINING.md](docs/TRAINING.md) · ajan kuralları: [AGENTS.md](AGENTS.md)
