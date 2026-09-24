#!/usr/bin/env python3
"""
Build and validate the shipped corpus.

Reads the authored tuples in corpus-src/, assigns FROZEN append-only ordinals,
enforces every gate from the PRD, and emits:

  data/words.seed.json      full authoring records (source of truth, versioned)
  public/corpus/<deck>.json stripped runtime bundles, lazy-loaded by the app
  data/ordinals.lock.json   the ordinal registry - NEVER regenerate from scratch

There are two corpus families and they do not share gates.

  pictionary  easy / moderate / hard / god. Scored on the four drawability axes,
              tier computed from score and domain, fun gate applied.
  charades    hindi / english. Film titles, acted rather than drawn, so the
              drawability rubric is meaningless against them: "Sholay" has no
              concreteness score. What is enforced instead is recognition (an
              editorial call made when the title is added), a word count a
              person can hold up on one hand, and the same ban list.

CRITICAL INVARIANT
  Ordinals are permanent. ordinals.lock.json maps key -> ord and is committed.
  New entries append at the next free ord. Retired entries keep their ord as a
  tombstone. Never renumber: every device's seen-bitmap is indexed by ord, and
  renumbering silently resurrects entries people have already played.

  Charades keys are namespaced `film:<norm>`; pictionary keys stay bare. That is
  not tidiness — "Titanic" is a legitimate Pictionary word AND a film, they live
  in different decks, and they must therefore hold different ordinals. Bare keys
  are left exactly as they were so no existing ordinal moves.

Usage:
  python3 scripts/build_corpus.py           # build + validate
  python3 scripts/build_corpus.py --check   # validate only, exit 1 on failure
"""
import json, os, re, sys, unicodedata
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "corpus-src"))

CORPUS_VERSION = "2026.09.4"
# The version every device compares against. Bumping it triggers reconcile() on
# next load: the seen-bitmap is kept, the unseen set is recomputed, and the new
# words appear without resurrecting a single word anyone has already played.

# --- TIER ASSIGNMENT ------------------------------------------------------
# Calibrated against the 1,100-word seed build. Two corrections came out of it,
# both documented in docs/TECHNICAL_SPEC.md "Rubric calibration":
#
# 1. Easy is 0-1, not 0-2. A word scoring 2 has two axes below perfect, which in
#    practice means a composed drawing rather than one canonical shape.
#    "Vending machine" (5,4,4,5 = 2) is genuinely harder to draw than "cat" (0).
#
# 2. The four axes CANNOT separate Hard from God Mode. Both tiers are abstract, so
#    both score 8-16 and the split was arbitrary: "peer pressure" and "the bystander
#    effect" both score 11. What actually separates them is REGISTER - God Mode words
#    are named terms of art from a specialist domain and need their meaning printed
#    under them; Hard words are abstract but everyday language. So the tier is
#    (score, domain), not score alone.
SPECIALIST = {"biases", "philosophy", "science", "biology",
              "economics", "internet", "maths", "literature"}
# 3. (Sep 2026) Cryptic played too easy and God Mode too hard, with nothing between.
#    Cryptic words are everyday abstractions a room reaches on the first decent
#    drawing (R is 4-5 on 94% of them); God Mode words are specialist terms of art
#    most of a room has never met (R is 1-3 on 77%). The gap is NAMED REFERENCES
#    most people have heard of but must work to reach: myths, eponyms, famous
#    effects, history, stories. Like the Hard/God split, it is register - a domain
#    rule - not a score band, because the score cannot tell these apart either.
BRIDGE = {"myths", "eponyms", "effects", "history", "culture"}
# Tiers whose words are named references and ship with a printed meaning.
MEANING_TIERS = {"expert", "god"}
TIER_ORDER = ["easy", "moderate", "hard", "expert", "god"]
TIER_POINTS = {"easy": 1, "moderate": 2, "hard": 3, "expert": 4, "god": 5}
MAX_WORDS = 7   # idioms legitimately run long: "let the cat out of the bag" is 7 and is a great card.
                # The UI shows pips for 1-4 words and a numeric badge for 5+ (see DESIGN_SPEC).

# --- CHARADES -------------------------------------------------------------
# Flat scoring, deliberately. The two decks hold films of every era and every
# level of obscurity in no particular order, so there is no difficulty gradient
# to weight - and one point per film makes a session score read as "we got nine",
# which is the number the room is actually keeping.
CHARADES_ORDER = ["hindi", "english"]
CHARADES_POINTS = {"hindi": 1, "english": 1}
CHARADES_MAX_WORDS = 8    # "Harry Potter and the Prisoner of Azkaban" is 6 and fine to signal.
CHARADES_MAX_CHARS = 44   # what fits on a phone at the word screen's type size.

DECK_ORDER = TIER_ORDER + CHARADES_ORDER
DECK_POINTS = {**TIER_POINTS, **CHARADES_POINTS}

# Every file this script writes, written the same way on every platform.
#
# Without this, Python picks the console codepage: on Windows that is cp1252,
# which silently re-encodes the em dashes in the god-tier meanings and the curly
# apostrophes in the film titles into bytes no UTF-8 reader can decode. The app
# then paints a replacement character in front of a room, and the corpus diff
# shows hundreds of edits nobody made. Newlines are pinned for the same reason
# .gitattributes pins them: these files are committed and must not churn.
TEXT = {"encoding": "utf-8", "newline": "\n"}


def assign_tier(score, category):
    """Tier is fully determined by score and domain. There are no manual overrides."""
    if score <= 1:
        return "easy"
    if score <= 7:
        return "moderate"
    if category in SPECIALIST:
        return "god"
    return "expert" if category in BRIDGE else "hard"

BANNED = {
    # Minimal illustrative list. Expand before production; see docs/TECHNICAL_SPEC.md.
    "suicide", "rape", "nazi", "slave", "torture", "overdose", "genocide",
}

def norm(text):
    """Normalised key for duplicate detection: lowercase, strip accents & non-alnum."""
    t = unicodedata.normalize("NFKD", text.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", t).strip()

def film_norm(title):
    """
    norm() for a film title, with apostrophes closed up first.

    norm() turns every non-alphanumeric run into a space, so it would key
    "It's a Wonderful Life" as "it s a wonderful life" - a stray one-letter token
    that also breaks stem_key's near-duplicate matching. An apostrophe is inside
    a word, not between two, which is exactly what word_count() already says
    about "gambler's fallacy".

    norm() itself must NOT be changed to fix this: it is the key every Pictionary
    ordinal was assigned against. This applies only inside the `film:` namespace,
    which was minted with the apostrophes already closed up, so every film keeps
    the ordinal it was given.
    """
    return norm(re.sub(r"[’']", "", title))


def word_count(text):
    """
    How many words the room has to guess.

    NOT norm().split(). norm() turns every non-alphanumeric run into a space,
    which splits "gambler's fallacy" into three and made the word screen show
    three pips for a two-word phrase — actively misleading the people guessing.
    Apostrophes and hyphens are inside words, not between them: "gambler's" and
    "jack-o-lantern" are each one word.

    norm() itself must NOT be changed to fix this. It is the key ordinals are
    assigned against in data/ordinals.lock.json, and altering it would renumber
    the corpus and resurrect every word every device has already played.
    """
    t = unicodedata.normalize("NFKD", text.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"[’'\-]", "", t)            # possessives, contractions, compounds
    t = re.sub(r"[^a-z0-9]+", " ", t)             # everything else separates
    return len(t.split())


def stem_key(text):
    """Aggressive key for NEAR-duplicate detection: normalised, de-pluralised, sorted."""
    words = norm(text).split()
    stop = {"a", "an", "the", "of", "in", "on", "to", "and", "your", "you", "s"}
    out = []
    for w in words:
        if w in stop:
            continue
        for suf in ("ies", "es", "s"):
            if len(w) > 4 and w.endswith(suf):
                w = w[: -len(suf)] + ("y" if suf == "ies" else "")
                break
        out.append(w)
    return " ".join(sorted(out))


def load_tiers():
    import tier_easy, tier_moderate, tier_hard, tier_expert, tier_god
    return {
        "easy": tier_easy.WORDS,
        "moderate": tier_moderate.WORDS,
        "hard": tier_hard.WORDS,
        "expert": tier_expert.WORDS,
        "god": tier_god.WORDS,
    }


def load_charades():
    import charades_hindi, charades_english
    return {
        "hindi": charades_hindi.WORDS,
        "english": charades_english.WORDS,
    }


def load_lock():
    p = os.path.join(ROOT, "data", "ordinals.lock.json")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            lock = json.load(f)
        # "addedIn" arrived with the 2026.09.2 expansion. Anything already
        # holding an ordinal before it existed came in with the seed release.
        lock.setdefault("addedIn", {})
        for key in lock["assigned"]:
            lock["addedIn"].setdefault(key, "2026.09.1")
        return lock
    return {"nextOrd": 0, "assigned": {}, "tombstones": [], "addedIn": {}}


def take_ordinal(lock, key):
    """Frozen, append-only. Never reused, never renumbered."""
    if key in lock["assigned"]:
        return lock["assigned"][key]
    ordinal = lock["nextOrd"]
    lock["assigned"][key] = ordinal
    lock["addedIn"][key] = CORPUS_VERSION
    lock["nextOrd"] += 1
    return ordinal


def build():
    tiers = load_tiers()
    charades = load_charades()
    lock = load_lock()
    errors, warnings = [], []
    records = []

    seen_norm = {}
    seen_stem = defaultdict(list)

    for tier in TIER_ORDER:
        rows = tiers[tier]
        for row in rows:
            if tier in MEANING_TIERS:
                text, cat, C, F, D, R, T, meaning = row
            else:
                text, cat, C, F, D, R, T = row
                meaning = None
            text = text.strip()

            # --- gate: axis ranges ---
            for axis, v in zip("CFDRT", (C, F, D, R, T)):
                if not 1 <= v <= 5:
                    errors.append(f"[{tier}] '{text}': axis {axis}={v} out of range 1-5")

            score = 20 - (C + F + D + R)
            computed = assign_tier(score, cat)

            # --- gate: the file a word sits in must equal its computed tier ---
            # No overrides. If these disagree, either the scores are wrong or the word
            # is in the wrong file - both are authoring bugs, not judgement calls.
            if computed != tier:
                errors.append(
                    f"[{tier}] '{text}': scores {C}{F}{D}{R} -> {score} in domain "
                    f"'{cat}' = {computed}. Move it to tier_{computed}.py or rescore."
                )

            # --- gate: tier-aware fun gate (PRD 05) ---
            if tier == "easy":
                if not (C >= 4 and R == 5):
                    errors.append(
                        f"[easy] '{text}': fails Easy gate (needs C>=4 and R=5, has C={C} R={R})"
                    )
            else:
                if T < 2:
                    errors.append(
                        f"[{tier}] '{text}': fails fun gate (T={T}, needs >=2 or a delight note)"
                    )

            # --- gate: God Mode meanings are mandatory (FR-13, revised Sep 2026) ---
            # The word screen prints this under the word, always, with no tap and no
            # points penalty. A god word whose meaning is missing is a dead round, so
            # the build refuses to ship one. 120 chars is what fits on a phone at the
            # meaning's type size without pushing the outcome buttons off-screen.
            if tier in MEANING_TIERS:
                if not meaning or len(meaning.strip()) < 8:
                    errors.append(f"[{tier}] '{text}': missing or too-short meaning")
                elif len(meaning) > 120:
                    errors.append(f"[{tier}] '{text}': meaning is {len(meaning)} chars, max 120")

            # --- gate: word count 1-7 (FR-09) ---
            wc = word_count(text)
            if not 1 <= wc <= MAX_WORDS:
                errors.append(f"[{tier}] '{text}': {wc} words, max {MAX_WORDS}")
            if tier == "easy" and wc > 3:
                errors.append(f"[easy] '{text}': {wc} words. Easy entries are 1-3 words.")

            # --- gate: uniqueness within the pictionary corpus ---
            nk = norm(text)
            if nk in seen_norm:
                errors.append(f"DUPLICATE: '{text}' ({tier}) already in {seen_norm[nk]}")
            seen_norm[nk] = tier

            sk = stem_key(text)
            seen_stem[sk].append((text, tier))

            # --- gate: ban list ---
            for bad in BANNED:
                if bad in nk.split():
                    errors.append(f"[{tier}] '{text}': hits ban list ({bad})")

            ordinal = take_ordinal(lock, nk)

            records.append({
                "id": f"{tier[:1]}-{ordinal:05d}",
                "ord": ordinal,
                "text": text,
                "family": "pictionary",
                "tier": tier,
                "words": wc,
                "category": cat,
                "axes": {"C": C, "F": F, "D": D, "R": R, "T": T},
                "score": score,
                "computedTier": computed,
                "override": None,
                "meaning": meaning,
                "locale": ["global"],
                "volatility": "evergreen",
                "addedIn": lock["addedIn"].get(nk, CORPUS_VERSION),
            })

    # --- charades ---------------------------------------------------------
    # Its own namespace for every gate that asks "have I seen this before".
    # A film sharing a title with a Pictionary word is not a duplicate; they are
    # two entries in two decks and each needs an ordinal of its own.
    seen_film = {}
    film_stem = defaultdict(list)

    for deck in CHARADES_ORDER:
        for title, cat in charades[deck]:
            title = title.strip()

            if not cat:
                errors.append(f"[{deck}] '{title}': no category — anti-clustering needs one")

            wc = word_count(title)
            if not 1 <= wc <= CHARADES_MAX_WORDS:
                errors.append(f"[{deck}] '{title}': {wc} words, max {CHARADES_MAX_WORDS}")
            if len(title) > CHARADES_MAX_CHARS:
                errors.append(
                    f"[{deck}] '{title}': {len(title)} chars, max {CHARADES_MAX_CHARS}"
                )

            nk = film_norm(title)
            if nk in seen_film:
                errors.append(f"DUPLICATE FILM: '{title}' ({deck}) already in {seen_film[nk]}")
            seen_film[nk] = deck
            film_stem[stem_key(nk)].append((title, deck))

            for bad in BANNED:
                if bad in nk.split():
                    errors.append(f"[{deck}] '{title}': hits ban list ({bad})")

            ordinal = take_ordinal(lock, f"film:{nk}")

            records.append({
                "id": f"{deck[:1]}-{ordinal:05d}",
                "ord": ordinal,
                "text": title,
                "family": "charades",
                "tier": deck,
                "words": wc,
                "category": cat,
                "axes": None,
                "score": None,
                "computedTier": deck,
                "override": None,
                "meaning": None,
                "locale": ["global"],
                "volatility": "evergreen",
                "addedIn": lock["addedIn"].get(f"film:{nk}", CORPUS_VERSION),
            })

    # --- near-duplicate report --------------------------------------------
    for group_map in (seen_stem, film_stem):
        for sk, group in group_map.items():
            if len(group) > 1:
                names = ", ".join(f"'{t}' ({tr})" for t, tr in group)
                warnings.append(f"NEAR-DUPLICATE stem '{sk}': {names}")

    return records, lock, errors, warnings


def report(records, errors, warnings):
    print("=" * 68)
    print(f"  CORPUS BUILD  ·  version {CORPUS_VERSION}")
    print("=" * 68)

    # V1.0 launch targets from the PRD. The seed is deliberately short of these -
    # it exists to prove the schema and let the engine be built against real data.
    LAUNCH_TARGET = {"easy": 1500, "moderate": 1500, "hard": 1200, "expert": 400, "god": 600}

    by_tier = Counter(r["tier"] for r in records)
    pictionary = [r for r in records if r["family"] == "pictionary"]
    films = [r for r in records if r["family"] == "charades"]

    print(f"\n  PICTIONARY")
    print(f"  {'tier':<10}{'words':>7}{'sessions':>11}{'10-ses bar':>13}"
          f"{'V1.0 target':>14}{'progress':>11}{'cats':>7}")
    for tier in TIER_ORDER:
        n, per = by_tier[tier], (15 if tier in MEANING_TIERS else 50)
        cats = len({r["category"] for r in records if r["tier"] == tier})
        bar = "met" if n / per >= 10 else f"{n/per/10:.0%}"
        tgt = LAUNCH_TARGET[tier]
        print(f"  {tier:<10}{n:>7}{n/per:>9.0f} s{bar:>13}{tgt:>14,}"
              f"{n/tgt:>10.0%}{cats:>7}")
    tot_t = sum(LAUNCH_TARGET.values())
    print(f"  {'TOTAL':<10}{len(pictionary):>7}{'':>11}{'':>13}{tot_t:>14,}"
          f"{len(pictionary)/tot_t:>10.0%}")

    # A charades session is shorter than a Pictionary one - acting a film takes
    # longer than drawing a cat, and the room talks more between rounds - so the
    # session bar is 25 draws, not 50. Mixed is not a deck: it deals from both.
    print(f"\n  DUMB CHARADES")
    print(f"  {'deck':<10}{'films':>7}{'sessions':>11}{'10-ses bar':>13}{'cats':>7}")
    for deck in CHARADES_ORDER:
        n = by_tier[deck]
        cats = len({r["category"] for r in records if r["tier"] == deck})
        bar = "met" if n / 25 >= 10 else f"{n/25/10:.0%}"
        print(f"  {deck:<10}{n:>7}{n/25:>9.0f} s{bar:>13}{cats:>7}")
    print(f"  {'mixed':<10}{len(films):>7}{len(films)/25:>9.0f} s"
          f"{('met' if len(films)/25 >= 10 else 'x'):>13}")

    print(f"\n  multi-word entries: {sum(1 for r in records if r['words'] > 1)} "
          f"({sum(1 for r in records if r['words'] > 1)/len(records)*100:.0f}%)")
    for mt in ("expert", "god"):
        print(f"  {mt} meanings: {sum(1 for r in records if r['tier'] == mt and r['meaning'])}/{by_tier[mt]}")
    print(f"  ordinal range:      0 - {max(r['ord'] for r in records)}")

    if warnings:
        print(f"\n  WARNINGS ({len(warnings)})")
        for w in warnings[:20]:
            print(f"    ! {w}")
        if len(warnings) > 20:
            print(f"    ... and {len(warnings)-20} more")

    if errors:
        print(f"\n  ERRORS ({len(errors)})  — build fails")
        for e in errors[:40]:
            print(f"    x {e}")
        if len(errors) > 40:
            print(f"    ... and {len(errors)-40} more")
    else:
        print("\n  All gates passed.")
    print()


def emit(records, lock):
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "public", "corpus"), exist_ok=True)

    with open(os.path.join(ROOT, "data", "words.seed.json"), "w", **TEXT) as f:
        json.dump({"corpusVersion": CORPUS_VERSION, "words": records}, f, indent=2, ensure_ascii=False)

    with open(os.path.join(ROOT, "data", "ordinals.lock.json"), "w", **TEXT) as f:
        json.dump(lock, f, indent=2, ensure_ascii=False)

    # Runtime bundles: authoring fields stripped (NFR-02b)
    sizes = {}
    for deck in DECK_ORDER:
        rows = [r for r in records if r["tier"] == deck]
        payload = {
            "corpusVersion": CORPUS_VERSION,
            "tier": deck,
            "points": DECK_POINTS[deck],
            "count": len(rows),
            "maxOrd": max(r["ord"] for r in rows),
            "words": [
                {k: v for k, v in (
                    ("o", r["ord"]), ("t", r["text"]), ("w", r["words"]),
                    ("c", r["category"]), ("m", r["meaning"]),
                ) if v is not None}
                for r in rows
            ],
        }
        p = os.path.join(ROOT, "public", "corpus", f"{deck}.json")
        with open(p, "w", **TEXT) as f:
            json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)
        sizes[deck] = os.path.getsize(p)

    import gzip
    print("  runtime bundles (what the app downloads)")
    total_gz = 0
    for deck in DECK_ORDER:
        p = os.path.join(ROOT, "public", "corpus", f"{deck}.json")
        gz = len(gzip.compress(open(p, "rb").read(), 9))
        total_gz += gz
        print(f"    {deck:<10}{sizes[deck]/1024:>7.1f} KB raw   {gz/1024:>6.1f} KB gzipped")
    print(f"    {'ALL':<10}{sum(sizes.values())/1024:>7.1f} KB raw   {total_gz/1024:>6.1f} KB gzipped"
          f"   (budget 300 KB)")
    print()


if __name__ == "__main__":
    records, lock, errors, warnings = build()
    report(records, errors, warnings)
    if errors:
        sys.exit(1)
    if "--check" not in sys.argv:
        emit(records, lock)
        print("  Wrote data/words.seed.json, data/ordinals.lock.json, public/corpus/*.json")
    sys.exit(0)
