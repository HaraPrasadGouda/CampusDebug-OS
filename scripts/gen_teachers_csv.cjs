// Generates new_teachers.csv for the admin "Bulk Ingest Teachers" flow.
// Run: node scripts/gen_teachers_csv.js  -> writes ../new_teachers.csv
const fs = require('fs');
const path = require('path');

// [staff_id, full_name, subject_specialization, department]
const rows = [
  // --- BTech CSE pairs (2 -> 4 each) ---
  ['FAC051','Dr. Ananya Rao','Data Structures & Algorithms and Operating Systems','Computer Science & Engineering'],
  ['FAC052','Dr. Vikram Mehta','Data Structures & Algorithms and Operating Systems','Computer Science & Engineering'],
  ['FAC053','Dr. Priya Nair','Object-Oriented Programming and Discrete Mathematics','Computer Science & Engineering'],
  ['FAC054','Dr. Rohan Iyer','Object-Oriented Programming and Discrete Mathematics','Computer Science & Engineering'],
  ['FAC055','Dr. Sneha Kulkarni','Database Management Systems and Computer Networks','Computer Science & Engineering'],
  ['FAC056','Dr. Arjun Pillai','Database Management Systems and Computer Networks','Computer Science & Engineering'],
  // --- BTech Data Science & AI ---
  ['FAC057','Dr. Meera Joshi','Data Structures for AI and Statistics for Data Science','Data Science & AI'],
  ['FAC058','Dr. Karan Deshpande','Data Structures for AI and Statistics for Data Science','Data Science & AI'],
  ['FAC059','Dr. Ishita Banerjee','Machine Learning Foundations and Data Visualization & BI','Data Science & AI'],
  ['FAC060','Dr. Aditya Chatterjee','Machine Learning Foundations and Data Visualization & BI','Data Science & AI'],
  ['FAC061','Dr. Neha Verma','Python Programming and Linear Algebra & Optimisation','Data Science & AI'],
  ['FAC062','Dr. Sanjay Khanna','Python Programming and Linear Algebra & Optimisation','Data Science & AI'],
  // --- BTech Electronics & Telecommunication ---
  ['FAC063','Dr. Pooja Menon','Digital Electronics and Communication Systems','Electronics & Telecommunication'],
  ['FAC064','Dr. Ritesh Bhatt','Digital Electronics and Communication Systems','Electronics & Telecommunication'],
  ['FAC065','Dr. Kavita Sharma','Signals & Systems and Electromagnetic Theory','Electronics & Telecommunication'],
  ['FAC066','Dr. Manish Tiwari','Signals & Systems and Electromagnetic Theory','Electronics & Telecommunication'],
  ['FAC067','Dr. Divya Saxena','Analog Circuit Design and Electronic Devices','Electronics & Telecommunication'],
  ['FAC068','Dr. Nitin Agarwal','Analog Circuit Design and Electronic Devices','Electronics & Telecommunication'],
  // --- BTech Mechanical ---
  ['FAC069','Dr. Ritu Kapoor','Thermodynamics and Fluid Mechanics','Mechanical Engineering'],
  ['FAC070','Dr. Ashok Reddy','Thermodynamics and Fluid Mechanics','Mechanical Engineering'],
  ['FAC071','Dr. Sunita Patil','Engineering Mechanics and Materials & Metallurgy','Mechanical Engineering'],
  ['FAC072','Dr. Deepak Nanda','Engineering Mechanics and Materials & Metallurgy','Mechanical Engineering'],
  ['FAC073','Dr. Lakshmi Rao','Manufacturing Processes and Machine Drawing & Design','Mechanical Engineering'],
  ['FAC074','Dr. Harish Bhat','Manufacturing Processes and Machine Drawing & Design','Mechanical Engineering'],
  // --- BTech Electrical ---
  ['FAC075','Dr. Geeta Pillai','Circuit Theory and Control Systems','Electrical Engineering'],
  ['FAC076','Dr. Suresh Nair','Circuit Theory and Control Systems','Electrical Engineering'],
  ['FAC077','Dr. Anjali Desai','Electrical Machines and Measurement & Instrumentation','Electrical Engineering'],
  ['FAC078','Dr. Pradeep Kumar','Electrical Machines and Measurement & Instrumentation','Electrical Engineering'],
  ['FAC079','Dr. Rekha Iyer','Power Systems and Power Electronics','Electrical Engineering'],
  ['FAC080','Dr. Mohan Lal','Power Systems and Power Electronics','Electrical Engineering'],
  // --- Shared (all BTech) ---
  ['FAC081','Dr. Shalini Gupta','Engineering Mathematics','Mathematics'],
  ['FAC082','Dr. Ramesh Chandra','Engineering Mathematics','Mathematics'],
  ['FAC083','Dr. Fatima Sheikh','Engineering Mathematics','Mathematics'],
  ['FAC084','Dr. Girish Bhatia','Engineering Mathematics','Mathematics'],
  ['FAC085','Dr. Sunita Malhotra','Pre-Placement Training','Training & Placement'],
  ['FAC086','Dr. Vivek Anand','Pre-Placement Training','Training & Placement'],
  // --- MTech CSE ---
  ['FAC087','Dr. Aparna Das','Advanced Algorithms and Concurrency Models','Computer Science & Engineering'],
  ['FAC088','Dr. Bimal Roy','Distributed Systems and Advanced Databases','Computer Science & Engineering'],
  ['FAC089','Dr. Chitra Venkat','Research Methodology','Computer Science & Engineering'],
  ['FAC090','Dr. Dinesh Puri','Optimization Techniques','Computer Science & Engineering'],
  // --- B.Sc Physical Sciences ---
  ['FAC091','Dr. Esha Pandey','Physics and Environmental Science','Physical Sciences'],
  ['FAC092','Dr. Farhan Qureshi','Chemistry and Technical Communication','Physical Sciences'],
  ['FAC093','Dr. Gauri Kulkarni','Mathematics I and Statistics','Physical Sciences'],
  // --- B.Sc Nursing ---
  ['FAC094','Dr. Heena Khan','Nursing Foundations and Psychology','Nursing'],
  ['FAC095','Dr. Imran Siddiqui','Anatomy and Physiology','Nursing'],
  ['FAC096','Dr. Jyoti Prasad','Biochemistry and Microbiology','Nursing'],
  ['FAC097','Dr. Kunal Bose','Community Health Nursing and Pharmacology','Nursing'],
];

const lines = ['staff_id,teacher_name,subject_specialization,department,password,phone_number'];
const usedPw = new Set();
rows.forEach((r, i) => {
  const phone = '9' + String(8000000000 + i).slice(-9);
  // password = firstname@randomNumber, unique within this batch
  const first = String(r[1]).split(' ')[1] || String(r[1]).split(' ')[0]; // skip "Dr."
  const base = first.toLowerCase().replace(/[^a-z]/g, '');
  let pw;
  do {
    pw = `${base}@${Math.floor(10000 + Math.random() * 90000)}`;
  } while (usedPw.has(pw));
  usedPw.add(pw);
  lines.push(`${r[0]},${r[1]},${r[2]},${r[3]},${pw},${phone}`);
});
const out = path.join(__dirname, '..', 'new_teachers.csv');
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`wrote ${rows.length} teachers to ${out}`);
