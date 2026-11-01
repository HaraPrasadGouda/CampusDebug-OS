// One-off: add the 47 new teachers (FAC051-FAC097) to the LIVE campus config
// (data/campus_config.json branch subject pools). The solver reads templates
// from this config, NOT from TT_TEMPLATES — that's why regenerating after a
// TT_TEMPLATES-only edit still scheduled nobody new.
// Run: node scripts/upgradeCampusPools.cjs
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'campus_config.json');
const db = JSON.parse(fs.readFileSync(file, 'utf8'));

// branch key -> subject code -> FAC IDs to ADD (deduped)
const ADD = {
    'BTech|Computer Science & Engineering': {
        DSA: ['FAC051', 'FAC052'], OS: ['FAC051', 'FAC052'],
        OOP: ['FAC053', 'FAC054'], DM: ['FAC053', 'FAC054'],
        DBMS: ['FAC055', 'FAC056'], CN: ['FAC055', 'FAC056'],
        MATHS: ['FAC081', 'FAC082', 'FAC083', 'FAC084'],
        PPT: ['FAC085', 'FAC086']
    },
    'BTech|Data Science & AI': {
        DSAI: ['FAC057', 'FAC058'], STAT: ['FAC057', 'FAC058'],
        ML: ['FAC059', 'FAC060'], DLV: ['FAC059', 'FAC060'],
        PY: ['FAC061', 'FAC062'], LA: ['FAC061', 'FAC062'],
        MATHS: ['FAC081', 'FAC082', 'FAC083', 'FAC084'],
        PPT: ['FAC085', 'FAC086']
    },
    'BTech|Electronics & Telecommunication': {
        DE: ['FAC063', 'FAC064'], CS: ['FAC063', 'FAC064'],
        SS: ['FAC065', 'FAC066'], EMT: ['FAC065', 'FAC066'],
        AC: ['FAC067', 'FAC068'], ED: ['FAC067', 'FAC068'],
        MATHS: ['FAC081', 'FAC082', 'FAC083', 'FAC084'],
        PPT: ['FAC085', 'FAC086']
    },
    'BTech|Mechanical Engineering': {
        TH: ['FAC069', 'FAC070'], FM: ['FAC069', 'FAC070'],
        EM: ['FAC071', 'FAC072'], MM: ['FAC071', 'FAC072'],
        MP: ['FAC073', 'FAC074'], MD: ['FAC073', 'FAC074'],
        MATHS: ['FAC081', 'FAC082', 'FAC083', 'FAC084'],
        PPT: ['FAC085', 'FAC086']
    },
    'BTech|Electrical Engineering': {
        CT: ['FAC075', 'FAC076'], CS2: ['FAC075', 'FAC076'],
        ELM: ['FAC077', 'FAC078'], MS: ['FAC077', 'FAC078'],
        PS: ['FAC079', 'FAC080'], PE: ['FAC079', 'FAC080'],
        MATHS: ['FAC081', 'FAC082', 'FAC083', 'FAC084'],
        PPT: ['FAC085', 'FAC086']
    },
    'MTech|Computer Science & Engineering': {
        AAG: ['FAC087'], CONC: ['FAC087'],
        DSYS: ['FAC088'], ADB: ['FAC088'],
        RM: ['FAC089'], OPT: ['FAC090']
    },
    'B.Sc|Physical Sciences': {
        PHY: ['FAC091'], EVS: ['FAC091'],
        CHEM: ['FAC092'], COMM: ['FAC092'],
        MATH1: ['FAC093'], STAT1: ['FAC093']
    },
    'B.Sc Nursing|Nursing': {
        NF: ['FAC094'], PSY: ['FAC094'],
        ANA: ['FAC095'], PHYSIO: ['FAC095'],
        BIOC: ['FAC096'], MICRO: ['FAC096'],
        CHN: ['FAC097'], PHARMA: ['FAC097']
    }
};

// Backup
const backup = path.join(__dirname, '..', 'backups', 'campus_config.pre-teacher-bump.json');
if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);

let added = 0;
for (const b of (db.branches || [])) {
    const add = ADD[b.key];
    if (!add) { console.warn('no mapping for branch', b.key); continue; }
    for (const s of (b.subjects || [])) {
        const extras = add[s.code];
        if (!extras) { console.warn('no mapping for', b.key, s.code); continue; }
        const pool = Array.isArray(s.pool) ? s.pool.map(String) : [];
        for (const id of extras) if (!pool.map(x => x.toUpperCase()).includes(id.toUpperCase())) { pool.push(id); added++; }
        s.pool = pool;
    }
}

db.updatedAt = new Date().toISOString();
db.updatedBy = 'script — teacher pool expansion (47 new faculty)';
fs.writeFileSync(file, JSON.stringify(db, null, 2));
console.log(`added ${added} pool entries across 8 branches → ${file}`);
console.log('backup:', backup);
