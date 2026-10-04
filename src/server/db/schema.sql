PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS specialties (
  id TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS specialty_aliases (
  id INTEGER PRIMARY KEY,
  specialty_id TEXT NOT NULL REFERENCES specialties(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL CHECK (language_code IN ('en', 'ar')),
  alias TEXT NOT NULL,
  UNIQUE (specialty_id, language_code, alias)
);

CREATE TABLE IF NOT EXISTS doctors (
  id TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  specialty_id TEXT NOT NULL REFERENCES specialties(id),
  clinic_location_en TEXT NOT NULL,
  clinic_location_ar TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS doctor_aliases (
  id INTEGER PRIMARY KEY,
  doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL CHECK (language_code IN ('en', 'ar')),
  alias TEXT NOT NULL,
  UNIQUE (doctor_id, language_code, alias)
);

CREATE TABLE IF NOT EXISTS doctor_languages (
  doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL CHECK (language_code IN ('en', 'ar')),
  PRIMARY KEY (doctor_id, language_code)
);

CREATE TABLE IF NOT EXISTS patients (
  patient_id TEXT PRIMARY KEY,
  full_name_en TEXT NOT NULL,
  full_name_ar TEXT NOT NULL,
  mobile_number TEXT
);

CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  doctor_id TEXT NOT NULL REFERENCES doctors(id),
  starts_at_utc TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('available', 'unavailable', 'booked')),
  seed_status TEXT NOT NULL CHECK (seed_status IN ('available', 'unavailable')),
  UNIQUE (doctor_id, starts_at_utc)
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  booking_reference TEXT NOT NULL UNIQUE,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id),
  doctor_id TEXT NOT NULL REFERENCES doctors(id),
  slot_id TEXT NOT NULL UNIQUE REFERENCES slots(id),
  created_at_utc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_doctors_specialty ON doctors(specialty_id);
CREATE INDEX IF NOT EXISTS idx_doctor_aliases_alias ON doctor_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_specialty_aliases_alias ON specialty_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_slots_doctor_time_status ON slots(doctor_id, starts_at_utc, status);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);

CREATE TABLE IF NOT EXISTS booking_results (
  pending_id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  result_json TEXT NOT NULL
);
