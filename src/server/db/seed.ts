import type Database from "better-sqlite3";

type SpecialtySeed = {
  id: string;
  nameEn: string;
  nameAr: string;
  aliasesEn: string[];
  aliasesAr: string[];
};

type DoctorSeed = {
  id: string;
  nameEn: string;
  nameAr: string;
  specialtyId: string;
  aliasesEn: string[];
  aliasesAr: string[];
};

const specialties: SpecialtySeed[] = [
  { id: "cardiology", nameEn: "Cardiology", nameAr: "أمراض القلب", aliasesEn: ["cardiology", "cardiologist", "heart clinic"], aliasesAr: ["أمراض القلب", "القلب", "طبيب قلب"] },
  { id: "dermatology", nameEn: "Dermatology", nameAr: "الأمراض الجلدية", aliasesEn: ["dermatology", "dermatologist", "skin clinic"], aliasesAr: ["الأمراض الجلدية", "الجلدية", "طبيب جلدية"] },
  { id: "pediatrics", nameEn: "Pediatrics", nameAr: "طب الأطفال", aliasesEn: ["pediatrics", "pediatrician", "children's clinic"], aliasesAr: ["طب الأطفال", "الأطفال", "طبيب أطفال"] },
  { id: "orthopedics", nameEn: "Orthopedics", nameAr: "جراحة العظام", aliasesEn: ["orthopedics", "orthopedic doctor", "bone clinic"], aliasesAr: ["جراحة العظام", "العظام", "طبيب عظام"] },
  { id: "ophthalmology", nameEn: "Ophthalmology", nameAr: "طب العيون", aliasesEn: ["ophthalmology", "eye doctor", "eye clinic"], aliasesAr: ["طب العيون", "العيون", "طبيب عيون"] },
  { id: "neurology", nameEn: "Neurology", nameAr: "طب الأعصاب", aliasesEn: ["neurology", "neurologist", "nerve clinic"], aliasesAr: ["طب الأعصاب", "الأعصاب", "طبيب أعصاب"] },
  { id: "endocrinology", nameEn: "Endocrinology", nameAr: "طب الغدد الصماء", aliasesEn: ["endocrinology", "endocrinologist", "hormone clinic"], aliasesAr: ["طب الغدد الصماء", "الغدد", "طبيب غدد"] },
  { id: "ob-gyn", nameEn: "Obstetrics and Gynecology", nameAr: "النساء والولادة", aliasesEn: ["obstetrics and gynecology", "ob-gyn", "women's clinic"], aliasesAr: ["النساء والولادة", "النساء", "طبيبة نساء"] },
  { id: "internal-medicine", nameEn: "Internal Medicine", nameAr: "الطب الباطني", aliasesEn: ["internal medicine", "internist", "medicine clinic"], aliasesAr: ["الطب الباطني", "الباطنية", "طبيب باطنية"] },
  { id: "dentistry", nameEn: "Dentistry", nameAr: "طب الأسنان", aliasesEn: ["dentistry", "dentist", "dental clinic"], aliasesAr: ["طب الأسنان", "الأسنان", "طبيب أسنان"] },
];

const doctors: DoctorSeed[] = [
  { id: "doc-001", nameEn: "Dr. Khalid Al-Otaibi", nameAr: "د. خالد العتيبي", specialtyId: "cardiology", aliasesEn: ["Khalid Al-Otaibi", "Dr Khalid Otaibi"], aliasesAr: ["خالد العتيبي", "دكتور خالد العتيبي"] },
  { id: "doc-002", nameEn: "Dr. Sara Al-Qahtani", nameAr: "د. سارة القحطاني", specialtyId: "cardiology", aliasesEn: ["Sara Al-Qahtani", "Dr Sara Qahtani"], aliasesAr: ["سارة القحطاني", "دكتورة سارة القحطاني"] },
  { id: "doc-003", nameEn: "Dr. Faisal Al-Harbi", nameAr: "د. فيصل الحربي", specialtyId: "cardiology", aliasesEn: ["Faisal Al-Harbi", "Dr Faisal Harbi", "Faisal"], aliasesAr: ["فيصل الحربي", "دكتور فيصل الحربي", "فيصل"] },
  { id: "doc-004", nameEn: "Dr. Reem Al-Dosari", nameAr: "د. ريم الدوسري", specialtyId: "dermatology", aliasesEn: ["Reem Al-Dosari", "Dr Reem Dosari"], aliasesAr: ["ريم الدوسري", "دكتورة ريم الدوسري"] },
  { id: "doc-005", nameEn: "Dr. Noura Al-Shammari", nameAr: "د. نورة الشمري", specialtyId: "dermatology", aliasesEn: ["Noura Al-Shammari", "Dr Noura Shammari"], aliasesAr: ["نورة الشمري", "دكتورة نورة الشمري"] },
  { id: "doc-006", nameEn: "Dr. Ahmed Al-Zahrani", nameAr: "د. أحمد الزهراني", specialtyId: "dermatology", aliasesEn: ["Ahmed Al-Zahrani", "Dr Ahmed Zahrani"], aliasesAr: ["أحمد الزهراني", "دكتور أحمد الزهراني"] },
  { id: "doc-007", nameEn: "Dr. Maha Al-Mutairi", nameAr: "د. مها المطيري", specialtyId: "pediatrics", aliasesEn: ["Maha Al-Mutairi", "Dr Maha Mutairi"], aliasesAr: ["مها المطيري", "دكتورة مها المطيري"] },
  { id: "doc-008", nameEn: "Dr. Omar Al-Ghamdi", nameAr: "د. عمر الغامدي", specialtyId: "pediatrics", aliasesEn: ["Omar Al-Ghamdi", "Dr Omar Ghamdi"], aliasesAr: ["عمر الغامدي", "دكتور عمر الغامدي"] },
  { id: "doc-009", nameEn: "Dr. Layan Al-Anazi", nameAr: "د. ليان العنزي", specialtyId: "pediatrics", aliasesEn: ["Layan Al-Anazi", "Dr Layan Anazi"], aliasesAr: ["ليان العنزي", "دكتورة ليان العنزي"] },
  { id: "doc-010", nameEn: "Dr. Hani Al-Salem", nameAr: "د. هاني السالم", specialtyId: "orthopedics", aliasesEn: ["Hani Al-Salem", "Dr Hani Salem"], aliasesAr: ["هاني السالم", "دكتور هاني السالم"] },
  { id: "doc-011", nameEn: "Dr. Abdullah Al-Rashid", nameAr: "د. عبدالله الراشد", specialtyId: "orthopedics", aliasesEn: ["Abdullah Al-Rashid", "Dr Abdullah Rashid"], aliasesAr: ["عبدالله الراشد", "دكتور عبدالله الراشد"] },
  { id: "doc-012", nameEn: "Dr. Lama Al-Shehri", nameAr: "د. لمى الشهري", specialtyId: "orthopedics", aliasesEn: ["Lama Al-Shehri", "Dr Lama Shehri"], aliasesAr: ["لمى الشهري", "دكتورة لمى الشهري"] },
  { id: "doc-013", nameEn: "Dr. Yasser Al-Farsi", nameAr: "د. ياسر الفارسي", specialtyId: "ophthalmology", aliasesEn: ["Yasser Al-Farsi", "Dr Yasser Farsi"], aliasesAr: ["ياسر الفارسي", "دكتور ياسر الفارسي"] },
  { id: "doc-014", nameEn: "Dr. Abeer Al-Hazmi", nameAr: "د. عبير الحازمي", specialtyId: "ophthalmology", aliasesEn: ["Abeer Al-Hazmi", "Dr Abeer Hazmi"], aliasesAr: ["عبير الحازمي", "دكتورة عبير الحازمي"] },
  { id: "doc-015", nameEn: "Dr. Rakan Al-Suwaidi", nameAr: "د. راكان السويدي", specialtyId: "ophthalmology", aliasesEn: ["Rakan Al-Suwaidi", "Dr Rakan Suwaidi"], aliasesAr: ["راكان السويدي", "دكتور راكان السويدي"] },
  { id: "doc-016", nameEn: "Dr. Amal Al-Khaldi", nameAr: "د. أمل الخالدي", specialtyId: "neurology", aliasesEn: ["Amal Al-Khaldi", "Dr Amal Khaldi"], aliasesAr: ["أمل الخالدي", "دكتورة أمل الخالدي"] },
  { id: "doc-017", nameEn: "Dr. Mazen Al-Suhaimi", nameAr: "د. مازن السحيمي", specialtyId: "neurology", aliasesEn: ["Mazen Al-Suhaimi", "Dr Mazen Suhaimi"], aliasesAr: ["مازن السحيمي", "دكتور مازن السحيمي"] },
  { id: "doc-018", nameEn: "Dr. Dana Al-Tamimi", nameAr: "د. دانا التميمي", specialtyId: "neurology", aliasesEn: ["Dana Al-Tamimi", "Dr Dana Tamimi"], aliasesAr: ["دانا التميمي", "دكتورة دانا التميمي"] },
  { id: "doc-019", nameEn: "Dr. Bader Al-Hassan", nameAr: "د. بدر الحسن", specialtyId: "endocrinology", aliasesEn: ["Bader Al-Hassan", "Dr Bader Hassan"], aliasesAr: ["بدر الحسن", "دكتور بدر الحسن"] },
  { id: "doc-020", nameEn: "Dr. Hala Al-Faraj", nameAr: "د. هالة الفرج", specialtyId: "endocrinology", aliasesEn: ["Hala Al-Faraj", "Dr Hala Faraj"], aliasesAr: ["هالة الفرج", "دكتورة هالة الفرج"] },
  { id: "doc-021", nameEn: "Dr. Turki Al-Yousef", nameAr: "د. تركي اليوسف", specialtyId: "endocrinology", aliasesEn: ["Turki Al-Yousef", "Dr Turki Yousef"], aliasesAr: ["تركي اليوسف", "دكتور تركي اليوسف"] },
  { id: "doc-022", nameEn: "Dr. Eman Al-Johani", nameAr: "د. إيمان الجهني", specialtyId: "ob-gyn", aliasesEn: ["Eman Al-Johani", "Dr Eman Johani"], aliasesAr: ["إيمان الجهني", "دكتورة إيمان الجهني"] },
  { id: "doc-023", nameEn: "Dr. Faisal Al-Mansour", nameAr: "د. فيصل المنصور", specialtyId: "ob-gyn", aliasesEn: ["Faisal Al-Mansour", "Dr Faisal Mansour", "Faisal"], aliasesAr: ["فيصل المنصور", "دكتور فيصل المنصور", "فيصل"] },
  { id: "doc-024", nameEn: "Dr. Shatha Al-Balawi", nameAr: "د. شذى البلوي", specialtyId: "ob-gyn", aliasesEn: ["Shatha Al-Balawi", "Dr Shatha Balawi"], aliasesAr: ["شذى البلوي", "دكتورة شذى البلوي"] },
  { id: "doc-025", nameEn: "Dr. Samer Al-Malki", nameAr: "د. سامر المالكي", specialtyId: "internal-medicine", aliasesEn: ["Samer Al-Malki", "Dr Samer Malki"], aliasesAr: ["سامر المالكي", "دكتور سامر المالكي"] },
  { id: "doc-026", nameEn: "Dr. Rania Al-Sharif", nameAr: "د. رانيا الشريف", specialtyId: "internal-medicine", aliasesEn: ["Rania Al-Sharif", "Dr Rania Sharif"], aliasesAr: ["رانيا الشريف", "دكتورة رانيا الشريف"] },
  { id: "doc-027", nameEn: "Dr. Abdulaziz Al-Abdullah", nameAr: "د. عبدالعزيز العبدالله", specialtyId: "internal-medicine", aliasesEn: ["Abdulaziz Al-Abdullah", "Dr Abdulaziz Abdullah"], aliasesAr: ["عبدالعزيز العبدالله", "دكتور عبدالعزيز العبدالله"] },
  { id: "doc-028", nameEn: "Dr. Nada Al-Khatib", nameAr: "د. ندى الخطيب", specialtyId: "dentistry", aliasesEn: ["Nada Al-Khatib", "Dr Nada Khatib"], aliasesAr: ["ندى الخطيب", "دكتورة ندى الخطيب"] },
  { id: "doc-029", nameEn: "Dr. Saud Al-Asmari", nameAr: "د. سعود الأسمري", specialtyId: "dentistry", aliasesEn: ["Saud Al-Asmari", "Dr Saud Asmari"], aliasesAr: ["سعود الأسمري", "دكتور سعود الأسمري"] },
  { id: "doc-030", nameEn: "Dr. Ghada Al-Ahmadi", nameAr: "د. غادة الأحمدي", specialtyId: "dentistry", aliasesEn: ["Ghada Al-Ahmadi", "Dr Ghada Ahmadi"], aliasesAr: ["غادة الأحمدي", "دكتورة غادة الأحمدي"] },
];

const patients = [
  { patientId: "P-1001", nameEn: "Mariam Al-Salem", nameAr: "مريم السالم" },
  { patientId: "P-1002", nameEn: "Omar Al-Qahtani", nameAr: "عمر القحطاني" },
  { patientId: "P-1003", nameEn: "Lina Al-Harbi", nameAr: "لينا الحربي" },
  { patientId: "123", nameEn: "Test Patient", nameAr: "مريض تجريبي" },
];

function futureUtcDate(dayOffset: number, hour: number, minute: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + dayOffset);
  value.setUTCHours(hour, minute, 0, 0);
  return value.toISOString();
}

export function seedDatabase(db: Database.Database) {
  const seed = db.transaction(() => {
    const insertSpecialty = db.prepare(
      "INSERT OR IGNORE INTO specialties (id, name_en, name_ar) VALUES (?, ?, ?)",
    );
    const insertSpecialtyAlias = db.prepare(
      "INSERT OR IGNORE INTO specialty_aliases (specialty_id, language_code, alias) VALUES (?, ?, ?)",
    );
    const insertDoctor = db.prepare(
      "INSERT OR IGNORE INTO doctors (id, name_en, name_ar, specialty_id, clinic_location_en, clinic_location_ar) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insertDoctorAlias = db.prepare(
      "INSERT OR IGNORE INTO doctor_aliases (doctor_id, language_code, alias) VALUES (?, ?, ?)",
    );
    const insertDoctorLanguage = db.prepare(
      "INSERT OR IGNORE INTO doctor_languages (doctor_id, language_code) VALUES (?, ?)",
    );
    const insertPatient = db.prepare(
      "INSERT OR IGNORE INTO patients (patient_id, full_name_en, full_name_ar) VALUES (?, ?, ?)",
    );
    const insertSlot = db.prepare(
      `INSERT INTO slots (id, doctor_id, starts_at_utc, status, seed_status) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET starts_at_utc = excluded.starts_at_utc
       WHERE slots.status != 'booked' AND slots.starts_at_utc <= ?`,
    );

    for (const specialty of specialties) {
      insertSpecialty.run(specialty.id, specialty.nameEn, specialty.nameAr);
      for (const alias of specialty.aliasesEn) insertSpecialtyAlias.run(specialty.id, "en", alias);
      for (const alias of specialty.aliasesAr) insertSpecialtyAlias.run(specialty.id, "ar", alias);
    }

    doctors.forEach((doctor, index) => {
      const clinicNumber = (index % 3) + 1;
      insertDoctor.run(
        doctor.id,
        doctor.nameEn,
        doctor.nameAr,
        doctor.specialtyId,
        `Main Hospital — Clinic ${clinicNumber}`,
        `المستشفى الرئيسي — العيادة ${clinicNumber}`,
      );
      for (const alias of [doctor.nameEn, ...doctor.aliasesEn]) insertDoctorAlias.run(doctor.id, "en", alias);
      for (const alias of [doctor.nameAr, ...doctor.aliasesAr]) insertDoctorAlias.run(doctor.id, "ar", alias);
      // Most fictional clinicians are bilingual; a few are Arabic-only so language filters have meaningful outcomes.
      const languages = index % 6 === 0 ? ["ar"] : ["en", "ar"];
      for (const language of languages) insertDoctorLanguage.run(doctor.id, language);

      insertSlot.run(`slot-${doctor.id}-1`, doctor.id, futureUtcDate(2, 9, 0), "available", "available", new Date().toISOString());
      insertSlot.run(`slot-${doctor.id}-2`, doctor.id, futureUtcDate(3, 11, 30), "unavailable", "unavailable", new Date().toISOString());
      insertSlot.run(`slot-${doctor.id}-3`, doctor.id, futureUtcDate(5, 14, 0), "available", "available", new Date().toISOString());
    });

    for (const patient of patients) {
      insertPatient.run(patient.patientId, patient.nameEn, patient.nameAr);
    }
  });

  seed.immediate();
}
