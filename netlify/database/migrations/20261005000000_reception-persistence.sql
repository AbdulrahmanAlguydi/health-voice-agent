-- Active receptionist persistence. The catalog is the existing fictional demo only.
CREATE TABLE reception_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE reception_specialties (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE TABLE reception_doctors (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE TABLE reception_services (
  id TEXT PRIMARY KEY,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0 AND duration_minutes % 15 = 0),
  lead_minutes INTEGER NOT NULL CHECK (lead_minutes >= 0),
  horizon_days INTEGER NOT NULL CHECK (horizon_days > 0),
  data TEXT NOT NULL
);
CREATE TABLE reception_sessions (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE TABLE reception_offers (
  seq BIGSERIAL UNIQUE NOT NULL,
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES reception_sessions(id),
  data TEXT NOT NULL
);
CREATE INDEX reception_offers_session_order ON reception_offers(session_id, seq);
CREATE TABLE reception_operations (
  seq BIGSERIAL UNIQUE NOT NULL,
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES reception_sessions(id),
  status TEXT NOT NULL CHECK (status IN ('ready','committed','rejected')),
  payload TEXT NOT NULL,
  result TEXT
);
CREATE INDEX reception_operations_session_order ON reception_operations(session_id, seq);
CREATE TABLE reception_events (
  session_id TEXT NOT NULL REFERENCES reception_sessions(id),
  id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result TEXT,
  PRIMARY KEY (session_id,id)
);
CREATE TABLE reception_media (
  session_id TEXT NOT NULL REFERENCES reception_sessions(id),
  id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (session_id,id)
);
CREATE TABLE reception_capacity (
  id TEXT PRIMARY KEY,
  doctor_id TEXT NOT NULL REFERENCES reception_doctors(id),
  starts_at_utc TEXT NOT NULL,
  UNIQUE (doctor_id,starts_at_utc)
);
CREATE TABLE reception_subjects (
  id TEXT PRIMARY KEY,
  patient_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  caller_name TEXT,
  relationship TEXT
);
CREATE INDEX reception_subjects_phone ON reception_subjects(phone);
CREATE TABLE reception_appointments (
  seq BIGSERIAL UNIQUE NOT NULL,
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES reception_subjects(id),
  doctor_id TEXT NOT NULL REFERENCES reception_doctors(id),
  service_id TEXT NOT NULL REFERENCES reception_services(id),
  starts_at_utc TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('active','cancelled')),
  classification TEXT,
  data TEXT NOT NULL
);
CREATE INDEX reception_appointments_subject_time ON reception_appointments(subject_id,status,starts_at_utc);
CREATE TABLE reception_occupancy (
  slot_id TEXT PRIMARY KEY REFERENCES reception_capacity(id),
  appointment_id TEXT NOT NULL REFERENCES reception_appointments(id)
);
CREATE INDEX reception_occupancy_appointment ON reception_occupancy(appointment_id);
CREATE TABLE reception_history (
  id BIGSERIAL PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES reception_appointments(id),
  action TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE reception_effects (
  seq BIGSERIAL UNIQUE NOT NULL,
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES reception_sessions(id),
  kind TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  data TEXT NOT NULL
);

INSERT INTO reception_specialties (id,data) VALUES
  ('cardiology', '{"id":"cardiology","nameEn":"Cardiology","nameAr":"أمراض القلب","aliasesEn":["cardiology","cardiologist","heart clinic"],"aliasesAr":["أمراض القلب","القلب","طبيب قلب"]}'),
  ('dentistry', '{"id":"dentistry","nameEn":"Dentistry","nameAr":"طب الأسنان","aliasesEn":["dentistry","dentist","dental clinic"],"aliasesAr":["طب الأسنان","الأسنان","طبيب أسنان"]}'),
  ('dermatology', '{"id":"dermatology","nameEn":"Dermatology","nameAr":"الأمراض الجلدية","aliasesEn":["dermatology","dermatologist","skin clinic"],"aliasesAr":["الأمراض الجلدية","الجلدية","طبيب جلدية"]}'),
  ('endocrinology', '{"id":"endocrinology","nameEn":"Endocrinology","nameAr":"طب الغدد الصماء","aliasesEn":["endocrinology","endocrinologist","hormone clinic"],"aliasesAr":["طب الغدد الصماء","الغدد","طبيب غدد"]}'),
  ('internal-medicine', '{"id":"internal-medicine","nameEn":"Internal Medicine","nameAr":"الطب الباطني","aliasesEn":["internal medicine","internist","medicine clinic"],"aliasesAr":["الطب الباطني","الباطنية","طبيب باطنية"]}'),
  ('neurology', '{"id":"neurology","nameEn":"Neurology","nameAr":"طب الأعصاب","aliasesEn":["neurology","neurologist","nerve clinic"],"aliasesAr":["طب الأعصاب","الأعصاب","طبيب أعصاب"]}'),
  ('ob-gyn', '{"id":"ob-gyn","nameEn":"Obstetrics and Gynecology","nameAr":"النساء والولادة","aliasesEn":["obstetrics and gynecology","ob-gyn","women''s clinic"],"aliasesAr":["النساء والولادة","النساء","طبيبة نساء"]}'),
  ('ophthalmology', '{"id":"ophthalmology","nameEn":"Ophthalmology","nameAr":"طب العيون","aliasesEn":["ophthalmology","eye doctor","eye clinic"],"aliasesAr":["طب العيون","العيون","طبيب عيون"]}'),
  ('orthopedics', '{"id":"orthopedics","nameEn":"Orthopedics","nameAr":"جراحة العظام","aliasesEn":["orthopedics","orthopedic doctor","bone clinic"],"aliasesAr":["جراحة العظام","العظام","طبيب عظام"]}'),
  ('pediatrics', '{"id":"pediatrics","nameEn":"Pediatrics","nameAr":"طب الأطفال","aliasesEn":["pediatrics","pediatrician","children''s clinic"],"aliasesAr":["طب الأطفال","الأطفال","طبيب أطفال"]}');
INSERT INTO reception_doctors (id,data) VALUES
  ('doc-001', '{"id":"doc-001","nameEn":"Dr. Khalid Al-Otaibi","nameAr":"د. خالد العتيبي","specialtyId":"cardiology","specialtyEn":"Cardiology","specialtyAr":"أمراض القلب","clinicLocationEn":"Main Hospital — Clinic 1","clinicLocationAr":"المستشفى الرئيسي — العيادة 1","aliasesEn":["Dr. Khalid Al-Otaibi","Khalid Al-Otaibi","Dr Khalid Otaibi"],"aliasesAr":["د. خالد العتيبي","خالد العتيبي","دكتور خالد العتيبي"],"spokenLanguages":["ar"]}'),
  ('doc-002', '{"id":"doc-002","nameEn":"Dr. Sara Al-Qahtani","nameAr":"د. سارة القحطاني","specialtyId":"cardiology","specialtyEn":"Cardiology","specialtyAr":"أمراض القلب","clinicLocationEn":"Main Hospital — Clinic 2","clinicLocationAr":"المستشفى الرئيسي — العيادة 2","aliasesEn":["Dr. Sara Al-Qahtani","Sara Al-Qahtani","Dr Sara Qahtani"],"aliasesAr":["د. سارة القحطاني","سارة القحطاني","دكتورة سارة القحطاني"],"spokenLanguages":["ar","en"]}'),
  ('doc-003', '{"id":"doc-003","nameEn":"Dr. Faisal Al-Harbi","nameAr":"د. فيصل الحربي","specialtyId":"cardiology","specialtyEn":"Cardiology","specialtyAr":"أمراض القلب","clinicLocationEn":"Main Hospital — Clinic 3","clinicLocationAr":"المستشفى الرئيسي — العيادة 3","aliasesEn":["Dr. Faisal Al-Harbi","Faisal Al-Harbi","Dr Faisal Harbi","Faisal"],"aliasesAr":["د. فيصل الحربي","فيصل الحربي","دكتور فيصل الحربي","فيصل"],"spokenLanguages":["ar","en"]}'),
  ('doc-004', '{"id":"doc-004","nameEn":"Dr. Reem Al-Dosari","nameAr":"د. ريم الدوسري","specialtyId":"dermatology","specialtyEn":"Dermatology","specialtyAr":"الأمراض الجلدية","clinicLocationEn":"Main Hospital — Clinic 1","clinicLocationAr":"المستشفى الرئيسي — العيادة 1","aliasesEn":["Dr. Reem Al-Dosari","Reem Al-Dosari","Dr Reem Dosari"],"aliasesAr":["د. ريم الدوسري","ريم الدوسري","دكتورة ريم الدوسري"],"spokenLanguages":["ar","en"]}'),
  ('doc-005', '{"id":"doc-005","nameEn":"Dr. Noura Al-Shammari","nameAr":"د. نورة الشمري","specialtyId":"dermatology","specialtyEn":"Dermatology","specialtyAr":"الأمراض الجلدية","clinicLocationEn":"Main Hospital — Clinic 2","clinicLocationAr":"المستشفى الرئيسي — العيادة 2","aliasesEn":["Dr. Noura Al-Shammari","Noura Al-Shammari","Dr Noura Shammari"],"aliasesAr":["د. نورة الشمري","نورة الشمري","دكتورة نورة الشمري"],"spokenLanguages":["ar","en"]}'),
  ('doc-006', '{"id":"doc-006","nameEn":"Dr. Ahmed Al-Zahrani","nameAr":"د. أحمد الزهراني","specialtyId":"dermatology","specialtyEn":"Dermatology","specialtyAr":"الأمراض الجلدية","clinicLocationEn":"Main Hospital — Clinic 3","clinicLocationAr":"المستشفى الرئيسي — العيادة 3","aliasesEn":["Dr. Ahmed Al-Zahrani","Ahmed Al-Zahrani","Dr Ahmed Zahrani"],"aliasesAr":["د. أحمد الزهراني","أحمد الزهراني","دكتور أحمد الزهراني"],"spokenLanguages":["ar","en"]}'),
  ('doc-007', '{"id":"doc-007","nameEn":"Dr. Maha Al-Mutairi","nameAr":"د. مها المطيري","specialtyId":"pediatrics","specialtyEn":"Pediatrics","specialtyAr":"طب الأطفال","clinicLocationEn":"Main Hospital — Clinic 1","clinicLocationAr":"المستشفى الرئيسي — العيادة 1","aliasesEn":["Dr. Maha Al-Mutairi","Maha Al-Mutairi","Dr Maha Mutairi"],"aliasesAr":["د. مها المطيري","مها المطيري","دكتورة مها المطيري"],"spokenLanguages":["ar"]}'),
  ('doc-008', '{"id":"doc-008","nameEn":"Dr. Omar Al-Ghamdi","nameAr":"د. عمر الغامدي","specialtyId":"pediatrics","specialtyEn":"Pediatrics","specialtyAr":"طب الأطفال","clinicLocationEn":"Main Hospital — Clinic 2","clinicLocationAr":"المستشفى الرئيسي — العيادة 2","aliasesEn":["Dr. Omar Al-Ghamdi","Omar Al-Ghamdi","Dr Omar Ghamdi"],"aliasesAr":["د. عمر الغامدي","عمر الغامدي","دكتور عمر الغامدي"],"spokenLanguages":["ar","en"]}'),
  ('doc-009', '{"id":"doc-009","nameEn":"Dr. Layan Al-Anazi","nameAr":"د. ليان العنزي","specialtyId":"pediatrics","specialtyEn":"Pediatrics","specialtyAr":"طب الأطفال","clinicLocationEn":"Main Hospital — Clinic 3","clinicLocationAr":"المستشفى الرئيسي — العيادة 3","aliasesEn":["Dr. Layan Al-Anazi","Layan Al-Anazi","Dr Layan Anazi"],"aliasesAr":["د. ليان العنزي","ليان العنزي","دكتورة ليان العنزي"],"spokenLanguages":["ar","en"]}'),
  ('doc-010', '{"id":"doc-010","nameEn":"Dr. Hani Al-Salem","nameAr":"د. هاني السالم","specialtyId":"orthopedics","specialtyEn":"Orthopedics","specialtyAr":"جراحة العظام","clinicLocationEn":"Main Hospital — Clinic 1","clinicLocationAr":"المستشفى الرئيسي — العيادة 1","aliasesEn":["Dr. Hani Al-Salem","Hani Al-Salem","Dr Hani Salem"],"aliasesAr":["د. هاني السالم","هاني السالم","دكتور هاني السالم"],"spokenLanguages":["ar","en"]}'),
  ('doc-011', '{"id":"doc-011","nameEn":"Dr. Abdullah Al-Rashid","nameAr":"د. عبدالله الراشد","specialtyId":"orthopedics","specialtyEn":"Orthopedics","specialtyAr":"جراحة العظام","clinicLocationEn":"Main Hospital — Clinic 2","clinicLocationAr":"المستشفى الرئيسي — العيادة 2","aliasesEn":["Dr. Abdullah Al-Rashid","Abdullah Al-Rashid","Dr Abdullah Rashid"],"aliasesAr":["د. عبدالله الراشد","عبدالله الراشد","دكتور عبدالله الراشد"],"spokenLanguages":["ar","en"]}'),
  ('doc-012', '{"id":"doc-012","nameEn":"Dr. Lama Al-Shehri","nameAr":"د. لمى الشهري","specialtyId":"orthopedics","specialtyEn":"Orthopedics","specialtyAr":"جراحة العظام","clinicLocationEn":"Main Hospital — Clinic 3","clinicLocationAr":"المستشفى الرئيسي — العيادة 3","aliasesEn":["Dr. Lama Al-Shehri","Lama Al-Shehri","Dr Lama Shehri"],"aliasesAr":["د. لمى الشهري","لمى الشهري","دكتورة لمى الشهري"],"spokenLanguages":["ar","en"]}'),
  ('doc-013', '{"id":"doc-013","nameEn":"Dr. Yasser Al-Farsi","nameAr":"د. ياسر الفارسي","specialtyId":"ophthalmology","specialtyEn":"Ophthalmology","specialtyAr":"طب العيون","clinicLocationEn":"Main Hospital — Clinic 1","clinicLocationAr":"المستشفى الرئيسي — العيادة 1","aliasesEn":["Dr. Yasser Al-Farsi","Yasser Al-Farsi","Dr Yasser Farsi"],"aliasesAr":["د. ياسر الفارسي","ياسر الفارسي","دكتور ياسر الفارسي"],"spokenLanguages":["ar"]}'),
  ('doc-014', '{"id":"doc-014","nameEn":"Dr. Abeer Al-Hazmi","nameAr":"د. عبير الحازمي","specialtyId":"ophthalmology","specialtyEn":"Ophthalmology","specialtyAr":"طب العيون","clinicLocationEn":"Main Hospital — Clinic 2","clinicLocationAr":"المستشفى الرئيسي — العيادة 2","aliasesEn":["Dr. Abeer Al-Hazmi","Abeer Al-Hazmi","Dr Abeer Hazmi"],"aliasesAr":["د. عبير الحازمي","عبير الحازمي","دكتورة عبير الحازمي"],"spokenLanguages":["ar","en"]}'),
  ('doc-015', '{"id":"doc-015","nameEn":"Dr. Rakan Al-Suwaidi","nameAr":"د. راكان السويدي","specialtyId":"ophthalmology","specialtyEn":"Ophthalmology","specialtyAr":"طب العيون","clinicLocationEn":"Main Hospital — Clinic 3","clinicLocationAr":"المستشفى الرئيسي — العيادة 3","aliasesEn":["Dr. Rakan Al-Suwaidi","Rakan Al-Suwaidi","Dr Rakan Suwaidi"],"aliasesAr":["د. راكان السويدي","راكان السويدي","دكتور راكان السويدي"],"spokenLanguages":["ar","en"]}'),
  ('doc-016', '{"id":"doc-016","nameEn":"Dr. Amal Al-Khaldi","nameAr":"د. أمل الخالدي","specialtyId":"neurology","specialtyEn":"Neurology","specialtyAr":"طب الأعصاب","clinicLocationEn":"Main Hospital — Clinic 1","clinicLocationAr":"المستشفى الرئيسي — العيادة 1","aliasesEn":["Dr. Amal Al-Khaldi","Amal Al-Khaldi","Dr Amal Khaldi"],"aliasesAr":["د. أمل الخالدي","أمل الخالدي","دكتورة أمل الخالدي"],"spokenLanguages":["ar","en"]}'),
  ('doc-017', '{"id":"doc-017","nameEn":"Dr. Mazen Al-Suhaimi","nameAr":"د. مازن السحيمي","specialtyId":"neurology","specialtyEn":"Neurology","specialtyAr":"طب الأعصاب","clinicLocationEn":"Main Hospital — Clinic 2","clinicLocationAr":"المستشفى الرئيسي — العيادة 2","aliasesEn":["Dr. Mazen Al-Suhaimi","Mazen Al-Suhaimi","Dr Mazen Suhaimi"],"aliasesAr":["د. مازن السحيمي","مازن السحيمي","دكتور مازن السحيمي"],"spokenLanguages":["ar","en"]}'),
  ('doc-018', '{"id":"doc-018","nameEn":"Dr. Dana Al-Tamimi","nameAr":"د. دانا التميمي","specialtyId":"neurology","specialtyEn":"Neurology","specialtyAr":"طب الأعصاب","clinicLocationEn":"Main Hospital — Clinic 3","clinicLocationAr":"المستشفى الرئيسي — العيادة 3","aliasesEn":["Dr. Dana Al-Tamimi","Dana Al-Tamimi","Dr Dana Tamimi"],"aliasesAr":["د. دانا التميمي","دانا التميمي","دكتورة دانا التميمي"],"spokenLanguages":["ar","en"]}'),
  ('doc-019', '{"id":"doc-019","nameEn":"Dr. Bader Al-Hassan","nameAr":"د. بدر الحسن","specialtyId":"endocrinology","specialtyEn":"Endocrinology","specialtyAr":"طب الغدد الصماء","clinicLocationEn":"Main Hospital — Clinic 1","clinicLocationAr":"المستشفى الرئيسي — العيادة 1","aliasesEn":["Dr. Bader Al-Hassan","Bader Al-Hassan","Dr Bader Hassan"],"aliasesAr":["د. بدر الحسن","بدر الحسن","دكتور بدر الحسن"],"spokenLanguages":["ar"]}'),
  ('doc-020', '{"id":"doc-020","nameEn":"Dr. Hala Al-Faraj","nameAr":"د. هالة الفرج","specialtyId":"endocrinology","specialtyEn":"Endocrinology","specialtyAr":"طب الغدد الصماء","clinicLocationEn":"Main Hospital — Clinic 2","clinicLocationAr":"المستشفى الرئيسي — العيادة 2","aliasesEn":["Dr. Hala Al-Faraj","Hala Al-Faraj","Dr Hala Faraj"],"aliasesAr":["د. هالة الفرج","هالة الفرج","دكتورة هالة الفرج"],"spokenLanguages":["ar","en"]}'),
  ('doc-021', '{"id":"doc-021","nameEn":"Dr. Turki Al-Yousef","nameAr":"د. تركي اليوسف","specialtyId":"endocrinology","specialtyEn":"Endocrinology","specialtyAr":"طب الغدد الصماء","clinicLocationEn":"Main Hospital — Clinic 3","clinicLocationAr":"المستشفى الرئيسي — العيادة 3","aliasesEn":["Dr. Turki Al-Yousef","Turki Al-Yousef","Dr Turki Yousef"],"aliasesAr":["د. تركي اليوسف","تركي اليوسف","دكتور تركي اليوسف"],"spokenLanguages":["ar","en"]}'),
  ('doc-022', '{"id":"doc-022","nameEn":"Dr. Eman Al-Johani","nameAr":"د. إيمان الجهني","specialtyId":"ob-gyn","specialtyEn":"Obstetrics and Gynecology","specialtyAr":"النساء والولادة","clinicLocationEn":"Main Hospital — Clinic 1","clinicLocationAr":"المستشفى الرئيسي — العيادة 1","aliasesEn":["Dr. Eman Al-Johani","Eman Al-Johani","Dr Eman Johani"],"aliasesAr":["د. إيمان الجهني","إيمان الجهني","دكتورة إيمان الجهني"],"spokenLanguages":["ar","en"]}'),
  ('doc-023', '{"id":"doc-023","nameEn":"Dr. Faisal Al-Mansour","nameAr":"د. فيصل المنصور","specialtyId":"ob-gyn","specialtyEn":"Obstetrics and Gynecology","specialtyAr":"النساء والولادة","clinicLocationEn":"Main Hospital — Clinic 2","clinicLocationAr":"المستشفى الرئيسي — العيادة 2","aliasesEn":["Dr. Faisal Al-Mansour","Faisal Al-Mansour","Dr Faisal Mansour","Faisal"],"aliasesAr":["د. فيصل المنصور","فيصل المنصور","دكتور فيصل المنصور","فيصل"],"spokenLanguages":["ar","en"]}'),
  ('doc-024', '{"id":"doc-024","nameEn":"Dr. Shatha Al-Balawi","nameAr":"د. شذى البلوي","specialtyId":"ob-gyn","specialtyEn":"Obstetrics and Gynecology","specialtyAr":"النساء والولادة","clinicLocationEn":"Main Hospital — Clinic 3","clinicLocationAr":"المستشفى الرئيسي — العيادة 3","aliasesEn":["Dr. Shatha Al-Balawi","Shatha Al-Balawi","Dr Shatha Balawi"],"aliasesAr":["د. شذى البلوي","شذى البلوي","دكتورة شذى البلوي"],"spokenLanguages":["ar","en"]}'),
  ('doc-025', '{"id":"doc-025","nameEn":"Dr. Samer Al-Malki","nameAr":"د. سامر المالكي","specialtyId":"internal-medicine","specialtyEn":"Internal Medicine","specialtyAr":"الطب الباطني","clinicLocationEn":"Main Hospital — Clinic 1","clinicLocationAr":"المستشفى الرئيسي — العيادة 1","aliasesEn":["Dr. Samer Al-Malki","Samer Al-Malki","Dr Samer Malki"],"aliasesAr":["د. سامر المالكي","سامر المالكي","دكتور سامر المالكي"],"spokenLanguages":["ar"]}'),
  ('doc-026', '{"id":"doc-026","nameEn":"Dr. Rania Al-Sharif","nameAr":"د. رانيا الشريف","specialtyId":"internal-medicine","specialtyEn":"Internal Medicine","specialtyAr":"الطب الباطني","clinicLocationEn":"Main Hospital — Clinic 2","clinicLocationAr":"المستشفى الرئيسي — العيادة 2","aliasesEn":["Dr. Rania Al-Sharif","Rania Al-Sharif","Dr Rania Sharif"],"aliasesAr":["د. رانيا الشريف","رانيا الشريف","دكتورة رانيا الشريف"],"spokenLanguages":["ar","en"]}'),
  ('doc-027', '{"id":"doc-027","nameEn":"Dr. Abdulaziz Al-Abdullah","nameAr":"د. عبدالعزيز العبدالله","specialtyId":"internal-medicine","specialtyEn":"Internal Medicine","specialtyAr":"الطب الباطني","clinicLocationEn":"Main Hospital — Clinic 3","clinicLocationAr":"المستشفى الرئيسي — العيادة 3","aliasesEn":["Dr. Abdulaziz Al-Abdullah","Abdulaziz Al-Abdullah","Dr Abdulaziz Abdullah"],"aliasesAr":["د. عبدالعزيز العبدالله","عبدالعزيز العبدالله","دكتور عبدالعزيز العبدالله"],"spokenLanguages":["ar","en"]}'),
  ('doc-028', '{"id":"doc-028","nameEn":"Dr. Nada Al-Khatib","nameAr":"د. ندى الخطيب","specialtyId":"dentistry","specialtyEn":"Dentistry","specialtyAr":"طب الأسنان","clinicLocationEn":"Main Hospital — Clinic 1","clinicLocationAr":"المستشفى الرئيسي — العيادة 1","aliasesEn":["Dr. Nada Al-Khatib","Nada Al-Khatib","Dr Nada Khatib"],"aliasesAr":["د. ندى الخطيب","ندى الخطيب","دكتورة ندى الخطيب"],"spokenLanguages":["ar","en"]}'),
  ('doc-029', '{"id":"doc-029","nameEn":"Dr. Saud Al-Asmari","nameAr":"د. سعود الأسمري","specialtyId":"dentistry","specialtyEn":"Dentistry","specialtyAr":"طب الأسنان","clinicLocationEn":"Main Hospital — Clinic 2","clinicLocationAr":"المستشفى الرئيسي — العيادة 2","aliasesEn":["Dr. Saud Al-Asmari","Saud Al-Asmari","Dr Saud Asmari"],"aliasesAr":["د. سعود الأسمري","سعود الأسمري","دكتور سعود الأسمري"],"spokenLanguages":["ar","en"]}'),
  ('doc-030', '{"id":"doc-030","nameEn":"Dr. Ghada Al-Ahmadi","nameAr":"د. غادة الأحمدي","specialtyId":"dentistry","specialtyEn":"Dentistry","specialtyAr":"طب الأسنان","clinicLocationEn":"Main Hospital — Clinic 3","clinicLocationAr":"المستشفى الرئيسي — العيادة 3","aliasesEn":["Dr. Ghada Al-Ahmadi","Ghada Al-Ahmadi","Dr Ghada Ahmadi"],"aliasesAr":["د. غادة الأحمدي","غادة الأحمدي","دكتورة غادة الأحمدي"],"spokenLanguages":["ar","en"]}');
INSERT INTO reception_services (id,duration_minutes,lead_minutes,horizon_days,data) VALUES
  ('consultation', 30, 60, 30, '{"id":"consultation","nameEn":"Consultation","nameAr":"استشارة","duration":30,"priceSar":150,"synthetic":true}'),
  ('extended_consultation', 60, 60, 30, '{"id":"extended_consultation","nameEn":"Extended consultation","nameAr":"استشارة مطولة","duration":60,"priceSar":250,"synthetic":true}');
INSERT INTO reception_metadata (key,value) VALUES ('clinic', '{"nameAr":"مجمع عافية الطبي","nameEn":"Afiyah Medical Center","synthetic":true,"catalogVersion":1,"locationAr":"جدة — حي الروضة (عنوان تجريبي)","locationEn":"Jeddah — Al Rawdah (fictional demo address)","hours":{"from":"09:00","to":"17:00","timeZone":"Asia/Riyadh"},"insurance":{"covered":false,"note":"Synthetic self-pay demo; insurance coverage is unknown"},"cancellationPolicy":{"lateBelowHours":24,"classification":"late_no_show","simulated":true,"financialPenalty":"unknown","feeInformationAvailable":false,"classificationIsAdministrativeOnly":true},"routing":[{"queryAr":"الجلد","queryEn":"skin","specialtyId":"dermatology"},{"queryAr":"الأسنان","queryEn":"teeth","specialtyId":"dentistry"},{"queryAr":"الأطفال","queryEn":"children","specialtyId":"pediatrics"}]}');
