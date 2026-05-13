# Vizit Destesi

Tıp / hemşirelik öğrencileri için kart destesi ile sözlü prova ve soru çalışma uygulaması. **Çoklu deste**, **JSON içe/dışa aktarma**, **kart düzenleme**, **yerel görsel** (data URL → IndexedDB). İlk kurulumda `default_deck.json` (160 kart, Hemşirelik Esasları) otomatik yüklenir.

## Dosyalar

| Dosya | Açıklama |
|--------|----------|
| `index.html` | Arayüz + sağ panel (desteler) + modallar |
| `styles.css` | Akademik yumuşak tema |
| `app.js` | Oyun + düzenleyici (ES modül) |
| `idb.js` | IndexedDB yardımcıları |
| `default_deck.json` | Varsayılan 160 kartlı deste |
| `questions.json` | PDF parse (referans) |
| `parse_pdf.py` | PDF → `questions.json` |

## Çalıştırma

```bash
cd /Users/huseyin/Desktop/vizit-destesi
python3 -m http.server 8000
```

Tarayıcı: `http://localhost:8000` — **mutlaka HTTP sunucusu** (ES modül + `fetch`).

## JSON şeması

Yeni deste için dosya ya **dizi** ya da **nesne**:

```json
{
  "name": "Sınav destem",
  "category": "Anatomi",
  "cards": [
    { "id": 1, "question": "...", "answer": "...", "image": "data:image/png;base64,..." }
  ]
}
```

- `image` isteğe bağlı; dışa aktarımda da `image` alanı kullanılır. `uid` varsa içe aktarımda korunur.
- Sadece dizi: `[{ "id", "question", "answer" }, ...]` — deste adı otomatik atanır.

## Kısayollar (modallar kapalıyken)

`Space` / `Enter` kart çek · `S` karıştır · `R` sıfırla · `C` cevap aç/kapat.
