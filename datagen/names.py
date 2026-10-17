"""Name pools for fictional people, partners and outlets."""

import numpy as np

MALE_FIRST = [
    "Agus", "Andi", "Arif", "Asep", "Bayu", "Bambang", "Dadang", "Dimas", "Eko", "Fajar",
    "Fikri", "Firman", "Galih", "Gilang", "Hadi", "Hafiz", "Ilham", "Irfan", "Iwan", "Joko",
    "Lukman", "Made", "Maruli", "Nanda", "Putu", "Rahmat", "Rangga", "Reza", "Rizky", "Rudi",
    "Sahat", "Surya", "Taufik", "Teguh", "Togar", "Ujang", "Wahyu", "Wayan", "Yoga", "Yusuf",
]
FEMALE_FIRST = [
    "Anisa", "Ayu", "Citra", "Dewi", "Dian", "Dina", "Eka", "Febri", "Fitri", "Gita",
    "Hana", "Indah", "Intan", "Kartika", "Komang", "Lestari", "Lia", "Maya", "Mega", "Nadia",
    "Novi", "Nur", "Puspita", "Putri", "Rahma", "Rani", "Ratna", "Siti", "Tika", "Vina",
    "Wida", "Wulan", "Yanti", "Yuni", "Zahra",
]
LAST = [
    "Batubara", "Daulay", "Fauzi", "Firmansyah", "Ginting", "Gunawan", "Hakim", "Halim",
    "Harahap", "Hermawan", "Hidayat", "Iskandar", "Kurniawan", "Kusuma", "Lubis", "Mahendra",
    "Manurung", "Mulyana", "Nasution", "Nugroho", "Pangestu", "Pasaribu", "Pattiasina", "Pohan",
    "Pratama", "Purnomo", "Rachman", "Rahman", "Ramadhan", "Rumbiak", "Rusdiana", "Santoso",
    "Saputra", "Sembiring", "Setiawan", "Siregar", "Sitompul", "Sopandi", "Sudrajat",
    "Sulistyo", "Supriatna", "Suryadi", "Syahputra", "Tamba", "Tanjung", "Tarigan", "Wenda",
    "Wibowo", "Wijaya",
]
FEMALE_LAST = ["Anggraini", "Handayani", "Maharani", "Permata", "Rahayu", "Susanti", "Wulandari"]

PARTNER_WORDS = ["Mitra", "Cakra", "Nusa", "Sinar", "Bintang", "Karya", "Mega", "Prima",
                 "Arta", "Jaya", "Sentosa", "Lintas", "Utama", "Buana", "Graha", "Samudra"]
PARTNER_SUFFIX = ["Distribusi", "Niaga", "Selular", "Komunika"]
OUTLET_PREFIX = ["Konter", "Toko", "Warung", "Ponsel", "Pulsa"]
OUTLET_SUFFIX = ["Cell", "Phone", "Celluler", "Jaya", "Mandiri", "Berkah", "Abadi"]


def person_name(rng: np.random.Generator, gender: str) -> str:
    if gender == "F":
        first = rng.choice(FEMALE_FIRST)
        last = rng.choice(LAST + FEMALE_LAST * 3)
    else:
        first = rng.choice(MALE_FIRST)
        last = rng.choice(LAST)
    return f"{first} {last}"


def partner_name(rng: np.random.Generator) -> str:
    a, b = rng.choice(PARTNER_WORDS, size=2, replace=False)
    return f"PT {a} {b} {rng.choice(PARTNER_SUFFIX)}"


def outlet_names(rng: np.random.Generator, n: int) -> list[str]:
    pre = rng.choice(OUTLET_PREFIX, n)
    who = rng.choice(MALE_FIRST + FEMALE_FIRST, n)
    suf = rng.choice(OUTLET_SUFFIX, n)
    return [f"{p} {w} {s}" for p, w, s in zip(pre, who, suf)]
