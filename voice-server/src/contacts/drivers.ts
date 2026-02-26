export interface Driver {
  id: string;
  name: string;
  vehicle: string;
  phone: string;
  years: number;
  personality: string;
  motivators: string;
  route: string;
  notes: string;
}

export const drivers: Driver[] = [
  {
    id: 'mike_reyes',
    name: 'Mike Reyes',
    vehicle: 'Demo-03',
    phone: process.env.MIKE_PHONE || '+15551234567',
    years: 8,
    personality: 'Friendly, easygoing. Loves F1 and soccer. Good driver but cuts corners when bored.',
    motivators: 'Competition with other drivers. Sports. Early finish bonus.',
    route: 'East LV Strip deliveries',
    notes: 'Tends to take long stops on race days. Responds well to humor.',
  },
  {
    id: 'sarah_chen',
    name: 'Sarah Chen',
    vehicle: 'Demo-08',
    phone: '+15551234568',
    years: 0.3,
    personality: 'Quiet, diligent, eager to prove herself. Asks a lot of questions.',
    motivators: 'Learning, positive feedback, clear instructions.',
    route: 'Downtown Henderson',
    notes: 'New hire. Check in more often. Very reliable.',
  },
  {
    id: 'dave_kowalski',
    name: 'Dave Kowalski',
    vehicle: 'Demo-17',
    phone: '+15551234569',
    years: 15,
    personality: "Old school. Doesn't love technology. Prefers phone calls to texts.",
    motivators: "Respect for experience. Don't micromanage.",
    route: 'I-15 corridor',
    notes: 'Slow but 100% completion rate. Leave him alone and he delivers.',
  },
  {
    id: 'ana_gutierrez',
    name: 'Ana Gutierrez',
    vehicle: 'Demo-06',
    phone: '+15551234570',
    years: 5,
    personality: 'High energy, competitive, takes pride in being fastest.',
    motivators: 'Leaderboard ranking, efficiency bonuses.',
    route: 'Summerlin',
    notes: 'Can handle extra stops if someone falls behind.',
  },
  {
    id: 'jt_thompson',
    name: "James 'JT' Thompson",
    vehicle: 'Demo-19',
    phone: '+15551234571',
    years: 2,
    personality: 'Charming but unreliable. Always has an elaborate excuse.',
    motivators: 'Keeping his job. Direct feedback.',
    route: 'South LV',
    notes: 'Watch closely. Three written warnings. Next incident is serious.',
  },
];

export function findDriverByName(name: string): Driver | undefined {
  const lower = name.toLowerCase();
  return drivers.find(
    (d) =>
      d.name.toLowerCase().includes(lower) ||
      d.id.toLowerCase().includes(lower) ||
      d.vehicle.toLowerCase().includes(lower)
  );
}

export function findDriverByPhone(phone: string): Driver | undefined {
  const normalized = phone.replace(/\D/g, '');
  return drivers.find((d) => d.phone.replace(/\D/g, '').endsWith(normalized.slice(-10)));
}

export function findDriverByVehicle(vehicle: string): Driver | undefined {
  const lower = vehicle.toLowerCase().replace(/[^a-z0-9]/g, '');
  return drivers.find((d) => {
    const dVehicle = d.vehicle.toLowerCase().replace(/[^a-z0-9]/g, '');
    return dVehicle.includes(lower) || lower.includes(dVehicle);
  });
}

export const bossPhone = process.env.BOSS_PHONE || '+15559999999';
