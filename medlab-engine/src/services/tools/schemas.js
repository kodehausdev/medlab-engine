// Gemini function-calling declarations. These are shared verbatim by the
// text path (generateContent tools) and the voice path (Live API setup
// message). Argument whitelists here are also what hipaa.guardToolArgs
// enforces — the schema IS the collection policy.

const TEST_CATALOG = [
  { code: 'BLOOD_DRAW', name: 'Blood Draw', duration_min: 15 },
  { code: 'LIPID_PANEL', name: 'Lipid Panel', duration_min: 15 },
  { code: 'PCR_SCAN', name: 'PCR Scan', duration_min: 20 },
  { code: 'CBC', name: 'Complete Blood Count (CBC)', duration_min: 15 },
  { code: 'A1C', name: 'Hemoglobin A1C', duration_min: 15 },
  { code: 'URINALYSIS', name: 'Urinalysis', duration_min: 10 },
];

const functionDeclarations = [
  {
    name: 'list_available_tests',
    description:
      'List the lab tests this location offers. Use when the caller asks what tests are available or names a test you cannot match to the catalog.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'check_availability',
    description:
      'Check open appointment slots for a given date. Optionally narrow to a specific time slot. Dates are YYYY-MM-DD; time slots are 24h HH:MM.',
    parameters: {
      type: 'OBJECT',
      properties: {
        date: {
          type: 'STRING',
          description: 'Requested date in YYYY-MM-DD format.',
        },
        time_slot: {
          type: 'STRING',
          description: 'Optional specific slot in HH:MM 24h format, e.g. "10:00".',
        },
      },
      required: ['date'],
    },
  },
  {
    name: 'book_appointment',
    description:
      'Book a lab appointment. Only call once you have confirmed patient name, test type, date and time slot with the caller. Do NOT ask for a phone number — the system books against caller ID automatically. NEVER pass medical history, symptoms, diagnoses or any health details — they are not accepted.',
    parameters: {
      type: 'OBJECT',
      properties: {
        patient_name: { type: 'STRING', description: 'Patient full name.' },
        phone_number: {
          type: 'STRING',
          description:
            'Optional. Omit it — the caller ID is used automatically. Only pass a number if the caller explicitly asks to use a different one.',
        },
        test_type: {
          type: 'STRING',
          description: `One of the catalog test names: ${TEST_CATALOG.map(t => t.name).join(', ')}.`,
        },
        date: { type: 'STRING', description: 'YYYY-MM-DD.' },
        time_slot: { type: 'STRING', description: 'HH:MM 24h, on a 30-minute boundary.' },
      },
      required: ['patient_name', 'test_type', 'date', 'time_slot'],
    },
  },
];

// Per-tool argument whitelists consumed by hipaa.guardToolArgs.
const TOOL_ARG_WHITELIST = {
  list_available_tests: [],
  check_availability: ['date', 'time_slot'],
  book_appointment: ['patient_name', 'phone_number', 'test_type', 'date', 'time_slot'],
};

module.exports = { functionDeclarations, TOOL_ARG_WHITELIST, TEST_CATALOG };
