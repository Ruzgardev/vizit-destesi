"""extracted.txt -> questions.json (Hemşirelik Esasları, 160 Q&A)."""
import json
import re
from pathlib import Path

src = Path(__file__).with_name("extracted.txt").read_text(encoding="utf-8")

raw_lines = [ln for ln in src.splitlines() if not ln.strip().startswith("===== PAGE")]

q_re_paren = re.compile(r"^\s*(\d{1,3})\s*[\)\]]\s*(.*\S)\s*$")
q_re_dot = re.compile(r"^\s*(\d{1,3})\.\s+(.*\S)\s*$")
q_re_stuck = re.compile(r"^\s*(\d{1,3})([A-ZÇĞİÖŞÜ].+?)\s*$")

bullet_re = re.compile(r"^\s*[•\-\*▪➢]\s*")
list_num_re = re.compile(r"^\s*\d{1,3}\.\s+")

question_hints = ("yazınız", "anlatınız", "söyleyiniz", "açıklayınız", "belirtiniz",
                  "tanımlayınız", "sayınız", "sıralayınız", "yapınız", "veriniz",
                  "nedir", "nelerdir", "kaçtır", "nasıl", "?")

end_chars = (".", "?", ":")


def is_question_text(text: str) -> bool:
    low = text.lower()
    if text.rstrip().endswith("?"):
        return True
    for h in question_hints:
        if h in low:
            return True
    return False


def match_question_line(ln: str, last_num: int):
    """Return (num, text) if ln looks like a new question, else None."""
    for rx, needs_hint in ((q_re_paren, False), (q_re_dot, True), (q_re_stuck, True)):
        m = rx.match(ln)
        if not m:
            continue
        num = int(m.group(1))
        text = m.group(2).strip()
        if not (last_num < num <= last_num + 8 and 1 <= num <= 200):
            continue
        if needs_hint and not is_question_text(text):
            continue
        if bullet_re.match(ln):
            continue
        return num, text
    return None


items = []
current = None
last_num = 0
i = 0
n = len(raw_lines)

imperative_endings = ("yazınız", "anlatınız", "söyleyiniz", "açıklayınız",
                      "belirtiniz", "tanımlayınız", "sayınız", "sıralayınız",
                      "yapınız", "veriniz")


def should_join_next(prev_text: str, next_raw: str) -> bool:
    nxt = next_raw.strip()
    if not nxt:
        return False
    if prev_text.rstrip().endswith(end_chars):
        return False
    last_word = prev_text.rstrip().split()[-1].lower().rstrip(".,;:?!")
    if last_word in imperative_endings:
        return False
    if match_question_line(next_raw, 0):
        return False
    if bullet_re.match(next_raw) or list_num_re.match(next_raw):
        return False
    if nxt.lower().startswith("o "):
        return False
    if nxt[0].isupper():
        return False
    return True


def split_inline_answer(text: str):
    """Bir soru metninde '?' sonrası gerçek bir cevap varsa, onu ayır.
    Eğer '?' sonrası sadece ek bir imperatif kelimeyse (örn 'Tanımlayınız.'), birleştir."""
    m = re.match(r"^(.+?\?)\s*(\S.*)$", text)
    if not m:
        return text.strip(), ""
    head, tail = m.group(1).strip(), m.group(2).strip()
    tail_words = tail.split()
    if len(tail_words) <= 3:
        last = tail_words[-1].lower().rstrip(".,;:?!")
        if last in imperative_endings:
            return (head + " " + tail).strip(), ""
    return head, tail


while i < n:
    ln = raw_lines[i]
    hit = match_question_line(ln, last_num)
    if hit:
        num, text = hit
        text = re.sub(r"\s+[A-Za-z]\s*$", "", text)
        if current:
            items.append(current)
        j = i + 1
        joined_count = 0
        while j < n and joined_count < 2 and should_join_next(text, raw_lines[j]):
            text = text.rstrip() + " " + raw_lines[j].strip()
            text = re.sub(r"\s+[A-Za-z]\s*$", "", text)
            joined_count += 1
            j += 1
        question_text, inline_answer = split_inline_answer(text)
        current = {"id": num, "question": question_text, "answer_lines": []}
        if inline_answer:
            current["answer_lines"].append(inline_answer)
        last_num = num
        i = j
        continue

    if current is not None and ln.strip():
        current["answer_lines"].append(ln.rstrip())
    i += 1

if current:
    items.append(current)


def clean_answer(lines):
    out = []
    for raw in lines:
        s = raw.strip()
        if not s:
            continue
        s = bullet_re.sub("• ", s)
        s = re.sub(r"^(\d+)[\.\)]\s+", r"\1. ", s)
        out.append(s)
    text = "\n".join(out)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


questions = [
    {"id": it["id"], "question": it["question"], "answer": clean_answer(it["answer_lines"])}
    for it in items
]

ids = [q["id"] for q in questions]
print(f"Toplam soru: {len(questions)}; min={min(ids)} max={max(ids)}")
missing = [i for i in range(1, max(ids) + 1) if i not in ids]
print(f"Eksik id'ler: {missing}")
empty = [q["id"] for q in questions if not q["answer"]]
print(f"Cevabi bos soru id'leri: {empty}")

print("\n--- Test örnekleri ---")
for tid in [1, 51, 89, 90, 91, 92, 103, 115, 124, 126, 129, 160]:
    q = next((x for x in questions if x["id"] == tid), None)
    if not q:
        print(f"[{tid}] (YOK)")
        continue
    print(f"[{tid}] Q: {q['question'][:110]}")
    a = q["answer"].replace("\n", " | ")
    print(f"     A: {a[:160]}")

Path(__file__).with_name("questions.json").write_text(
    json.dumps(questions, ensure_ascii=False, indent=2), encoding="utf-8"
)
print("\nquestions.json yazıldı.")
