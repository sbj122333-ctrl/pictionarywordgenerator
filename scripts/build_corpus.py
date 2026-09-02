#!/usr/bin/env python3
"""
Build and validate the shipped word corpus.

Reads the authored tuples in corpus-src/, assigns FROZEN append-only ordinals,
enforces every gate from the PRD, and emits:

  data/words.seed.json      full authoring records (source of truth, versioned)
  public/corpus/<tier>.json stripped runtime bundles, lazy-loaded by the app
  data/ordinals.lock.json   the ordinal registry - NEVER regenerate from scratch

CRITICAL INVARIANT
  Ordinals are permanent. ordinals.lock.json maps text -> ord and is committed.
  New words append at the next free ord. Retired words keep their ord as a
  tombstone. Never renumber: every device's seen-bitmap is indexed by ord, and
  renumbering silently resurrects words people have already played.

Usage:
  python3 scripts/build_corpus.py           # build + validate
  python3 scripts/build_corpus.py --check   # validate only, exit 1 on failure
"""
import json, os, re, sys, unicodedata
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "corpus-src"))

CORPUS_VERSION = "2026.09.1"

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
#    are named terms of art from a specialist domain and need a hint; Hard words are
#    abstract but everyday language. So the tier is (score, domain), not score alone.
SPECIALIST = {"biases", "philosophy", "science", "biology",
              "economics", "internet", "maths", "literature"}
TIER_ORDER = ["easy", "moderate", "hard", "god"]
TIER_POINTS = {"easy": 1, "moderate": 2, "hard": 3, "god": 4}
MAX_WORDS = 7   # idioms legitimately run long: "let the cat out of the bag" is 7 and is a great card.
                # The UI shows pips for 1-4 words and a numeric badge for 5+ (see DESIGN_SPEC).


def assign_tier(score, category):
    """Tier is fully determined by score and domain. There are no manual overrides."""
    if score <= 1:
        return "easy"
    if score <= 7:
        return "moderate"
    return "god" if category in SPECIALIST else "hard"

BANNED = {
    # Minimal illustrative list. Expand before production; see docs/TECHNICAL_SPEC.md.
    "suicide", "rape", "nazi", "slave", "torture", "overdose", "genocide",
}

def norm(text):
    """Normalised key for duplicate detection: lowercase, strip accents & non-alnum."""
    t = unicodedata.normalize("NFKD", text.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", t).strip()

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
    import tier_easy, tier_moderate, tier_hard, tier_god
    return {
        "easy": tier_easy.WORDS,
        "moderate": tier_moderate.WORDS,
        "hard": tier_hard.WORDS,
        "god": tier_god.WORDS,
    }


def load_lock():
    p = os.path.join(ROOT, "data", "ordinals.lock.json")
    if os.path.exists(p):
        with open(p) as f:
            return json.load(f)
    return {"nextOrd": 0, "assigned": {}, "tombstones": []}


def build():
    tiers = load_tiers()
    lock = load_lock()
    errors, warnings = [], []
    records = []

    seen_norm = {}
    seen_stem = defaultdict(list)

    for tier in TIER_ORDER:
        rows = tiers[tier]
        for row in rows:
            if tier == "god":
                text, cat, C, F, D, R, T, hint = row
            else:
                text, cat, C, F, D, R, T = row
                hint = None
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

            # --- gate: God Mode hints are mandatory (FR-13) ---
            if tier == "god":
                if not hint or len(hint.strip()) < 8:
                    errors.append(f"[god] '{text}': missing or too-short hint")
                elif len(hint) > 90:
                    errors.append(f"[god] '{text}': hint is {len(hint)} chars, max 90")

            # --- gate: word count 1-6 (FR-09) ---
            wc = len(norm(text).split())
            if not 1 <= wc <= MAX_WORDS:
                errors.append(f"[{tier}] '{text}': {wc} words, max {MAX_WORDS}")
            if tier == "easy" and wc > 3:
                errors.append(f"[easy] '{text}': {wc} words. Easy entries are 1-3 words.")

            # --- gate: global uniqueness ---
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

            # --- frozen ordinal assignment ---
            if nk in lock["assigned"]:
                ordinal = lock["assigned"][nk]
            else:
                ordinal = lock["nextOrd"]
                lock["assigned"][nk] = ordinal
                lock["nextOrd"] += 1

            records.append({
                "id": f"{tier[:1]}-{ordinal:05d}",
                "ord": ordinal,
                "text": text,
                "tier": tier,
                "words": wc,
                "category": cat,
                "axes": {"C": C, "F": F, "D": D, "R": R, "T": T},
                "score": score,
                "computedTier": computed,
                "override": None,
                "hint": hint,
                "locale": ["global"],
                "volatility": "evergreen",
                "addedIn": CORPUS_VERSION,
            })

    # --- near-duplicate report ---
    for sk, group in seen_stem.items():
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
    LAUNCH_TARGET = {"easy": 1500, "moderate": 1500, "hard": 1200, "god": 600}

    by_tier = Counter(r["tier"] for r in records)
    print(f"\n  {'tier':<10}{'words':>7}{'sessions':>11}{'10-ses bar':>13}"
          f"{'V1.0 target':>14}{'progress':>11}{'cats':>7}")
    for tier in TIER_ORDER:
        n, per = by_tier[tier], (15 if tier == "god" else 50)
        cats = len({r["category"] for r in records if r["tier"] == tier})
        bar = "met" if n / per >= 10 else f"{n/per/10:.0%}"
        tgt = LAUNCH_TARGET[tier]
        print(f"  {tier:<10}{n:>7}{n/per:>9.0f} s{bar:>13}{tgt:>14,}"
              f"{n/tgt:>10.0%}{cats:>7}")
    tot_t = sum(LAUNCH_TARGET.values())
    print(f"  {'TOTAL':<10}{len(records):>7}{'':>11}{'':>13}{tot_t:>14,}"
          f"{len(records)/tot_t:>10.0%}")
    print(f"\n  Seed corpus: sized to prove the schema and exercise the engine,")
    print(f"  not to launch. Grow it with the pipeline in docs/TECHNICAL_SPEC.md.")

    print(f"\n  multi-word entries: {sum(1 for r in records if r['words'] > 1)} "
          f"({sum(1 for r in records if r['words'] > 1)/len(records)*100:.0f}%)")
    print(f"  god-mode hints:     {sum(1 for r in records if r['hint'])}/{by_tier['god']}")
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

    with open(os.path.join(ROOT, "data", "words.seed.json"), "w") as f:
        json.dump({"corpusVersion": CORPUS_VERSION, "words": records}, f, indent=2, ensure_ascii=False)

    with open(os.path.join(ROOT, "data", "ordinals.lock.json"), "w") as f:
        json.dump(lock, f, indent=2, ensure_ascii=False)

    # Runtime bundles: authoring fields stripped (NFR-02b)
    sizes = {}
    for tier in TIER_ORDER:
        rows = [r for r in records if r["tier"] == tier]
        payload = {
            "corpusVersion": CORPUS_VERSION,
            "tier": tier,
            "points": TIER_POINTS[tier],
            "count": len(rows),
            "maxOrd": max(r["ord"] for r in rows),
            "words": [
                {k: v for k, v in (
                    ("o", r["ord"]), ("t", r["text"]), ("w", r["words"]),
                    ("c", r["category"]), ("h", r["hint"]),
                ) if v is not None}
                for r in rows
            ],
        }
        p = os.path.join(ROOT, "public", "corpus", f"{tier}.json")
        with open(p, "w") as f:
            json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)
        sizes[tier] = os.path.getsize(p)

    import gzip
    print("  runtime bundles (what the app downloads)")
    total_gz = 0
    for tier in TIER_ORDER:
        p = os.path.join(ROOT, "public", "corpus", f"{tier}.json")
        gz = len(gzip.compress(open(p, "rb").read(), 9))
        total_gz += gz
        print(f"    {tier:<10}{sizes[tier]/1024:>7.1f} KB raw   {gz/1024:>6.1f} KB gzipped")
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
