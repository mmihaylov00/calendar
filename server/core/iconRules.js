// Default icon rules, shared by the server (server/core/defaults.js), the admin and the display
// (web/shared/emoji.ts): English keywords, matched against event titles and descriptions.
// More specific categories come first. A plain module (not JSON) so it imports the same way on Node, Vite and Workers.
export default [
  {
    id: 'r_birthday', emoji: '🎂',
    match: [
      'birthday', 'bday', 'b-day',
    ],
  },
  {
    id: 'r_checkout', emoji: '🧳',
    match: [
      'check-out', 'checkout', 'check out', 'departure',
    ],
  },
  {
    id: 'r_airbnb', emoji: '🏠',
    match: [
      'airbnb', 'booking', 'vrbo', 'reservation', 'reserved', 'check-in', 'checkin', 'guest', 'guests',
    ],
  },
  {
    id: 'r_flight', emoji: '✈️',
    match: [
      'flight', 'fly to', 'airport', 'boarding',
    ],
  },
  {
    id: 'r_train', emoji: '🚆',
    match: [
      'train', 'railway',
    ],
  },
  {
    id: 'r_doctor', emoji: '🩺',
    match: [
      'doctor', 'dr.', 'gp', 'dentist', 'orthodontist', 'pediatrician', 'appointment', 'checkup', 'check-up', 'hospital', 'clinic', 'physio', 'therapy', 'vaccine', 'optician',
    ],
  },
  {
    id: 'r_pharmacy', emoji: '💊',
    match: [
      'pharmacy', 'prescription', 'medication', 'medicine',
    ],
  },
  {
    id: 'r_school', emoji: '🎒',
    match: [
      'school', 'kindergarten', 'nursery', 'daycare', 'parents evening', 'field trip',
    ],
  },
  {
    id: 'r_exam', emoji: '📝',
    match: [
      'exam', 'quiz', 'homework', 'assignment',
    ],
  },
  {
    id: 'r_swim', emoji: '🏊',
    match: [
      'swim', 'swimming', 'pool',
    ],
  },
  {
    id: 'r_sport', emoji: '🏃',
    match: [
      'football', 'soccer', 'basketball', 'gym', 'workout', 'training', 'padel', 'tennis', 'sport', 'sports', 'match', 'running', 'run', 'yoga', 'pilates', 'dance', 'karate', 'judo', 'cycling', 'hiking',
    ],
  },
  {
    id: 'r_haircut', emoji: '💇',
    match: [
      'haircut', 'hairdresser', 'barber', 'salon',
    ],
  },
  {
    id: 'r_coffee', emoji: '☕',
    match: [
      'coffee', 'café', 'brunch', 'breakfast',
    ],
  },
  {
    id: 'r_dinner', emoji: '🍽️',
    match: [
      'dinner', 'restaurant', 'lunch', 'bbq', 'barbecue',
    ],
  },
  {
    id: 'r_drinks', emoji: '🍻',
    match: [
      'drinks', 'beers', 'pub', 'bar', 'happy hour',
    ],
  },
  {
    id: 'r_party', emoji: '🥳',
    match: [
      'party', 'celebration', 'sleepover', 'playdate', 'christening', 'communion',
    ],
  },
  {
    id: 'r_meeting', emoji: '💼',
    match: [
      'meeting', 'call', 'zoom', 'teams', 'google meet', 'interview', 'conference', 'presentation',
    ],
  },
  {
    id: 'r_work', emoji: '💻',
    match: [
      'work', 'office', 'shift', 'on call',
    ],
  },
  {
    id: 'r_holiday', emoji: '🎉',
    match: [
      'public holiday', 'bank holiday', 'national holiday',
    ],
  },
  {
    id: 'r_vacation', emoji: '🏖️',
    match: [
      'holiday', 'holidays', 'vacation', 'trip', 'getaway', 'beach', 'camping',
    ],
  },
  {
    id: 'r_wedding', emoji: '💍',
    match: [
      'wedding', 'engagement',
    ],
  },
  {
    id: 'r_shopping', emoji: '🛒',
    match: [
      'shopping', 'groceries', 'grocery', 'supermarket', 'market',
    ],
  },
  {
    id: 'r_delivery', emoji: '📦',
    match: [
      'delivery', 'package', 'parcel', 'pick up parcel',
    ],
  },
  {
    id: 'r_car', emoji: '🚗',
    match: [
      'car', 'garage', 'mechanic', 'mot', 'inspection', 'car wash', 'tyres',
    ],
  },
  {
    id: 'r_repair', emoji: '🔧',
    match: [
      'plumber', 'electrician', 'repair', 'technician', 'maintenance', 'installer',
    ],
  },
  {
    id: 'r_cleaning', emoji: '🧹',
    match: [
      'cleaning', 'cleaner', 'housekeeping', 'laundry',
    ],
  },
  {
    id: 'r_trash', emoji: '🗑️',
    match: [
      'trash', 'garbage', 'rubbish', 'bins', 'bin day', 'recycling',
    ],
  },
  {
    id: 'r_garden', emoji: '🌱',
    match: [
      'garden', 'gardening', 'plants', 'lawn',
    ],
  },
  {
    id: 'r_bill', emoji: '💶',
    match: [
      'bill', 'invoice', 'payment', 'pay', 'rent', 'mortgage', 'taxes', 'insurance',
    ],
  },
  {
    id: 'r_deadline', emoji: '⏰',
    match: [
      'deadline', 'due',
    ],
  },
  {
    id: 'r_vet', emoji: '🐾',
    match: [
      'vet', 'veterinary', 'grooming', 'dog', 'puppy',
    ],
  },
  {
    id: 'r_music', emoji: '🎹',
    match: [
      'piano', 'guitar', 'violin', 'music lesson', 'choir', 'band practice',
    ],
  },
  {
    id: 'r_cinema', emoji: '🎬',
    match: [
      'cinema', 'movie', 'movies', 'film', 'theatre', 'theater', 'show',
    ],
  },
  {
    id: 'r_concert', emoji: '🎵',
    match: [
      'concert', 'festival', 'gig', 'live music',
    ],
  },
  {
    id: 'r_babysitter', emoji: '🧸',
    match: [
      'babysitter', 'babysitting', 'nanny', 'baby-sitter',
    ],
  },
];
