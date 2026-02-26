/**
 * Mock fleet data for demo mode
 * Matches the F1 scenario: Mike (Demo-03) stopped on LV Blvd watching F1 practice
 */

import { VehicleStatus, FleetOverview } from './geotab-client';

// Demo scenario state - can be modified during runtime
export const demoState = {
  mikeStoppedMinutes: 40,
  mikeStartedMoving: false,
};

// Las Vegas coordinates
const LV_STRIP = { lat: 36.1147, lng: -115.1728 }; // Sahara & Strip
const SUMMERLIN = { lat: 36.1871, lng: -115.2942 };
const HENDERSON = { lat: 36.0395, lng: -114.9817 };
const I15_CORRIDOR = { lat: 36.2388, lng: -115.1464 };
const SOUTH_LV = { lat: 36.0051, lng: -115.1391 };

export const mockVehicles: Record<string, VehicleStatus> = {
  'Demo-03': {
    id: 'demo-03-id',
    name: 'Demo-03',
    latitude: LV_STRIP.lat,
    longitude: LV_STRIP.lng,
    speed: 0,
    bearing: 45,
    isDriving: false,
    isDeviceCommunicating: true,
    currentStateDuration: 'PT40M', // 40 minutes stopped
    driver: 'mike_reyes',
    odometer: 45230,
    engineHours: 1245,
  },
  'Demo-06': {
    id: 'demo-06-id',
    name: 'Demo-06',
    latitude: SUMMERLIN.lat,
    longitude: SUMMERLIN.lng,
    speed: 35,
    bearing: 180,
    isDriving: true,
    isDeviceCommunicating: true,
    currentStateDuration: 'PT15M',
    driver: 'ana_gutierrez',
    odometer: 38420,
    engineHours: 980,
  },
  'Demo-08': {
    id: 'demo-08-id',
    name: 'Demo-08',
    latitude: HENDERSON.lat,
    longitude: HENDERSON.lng,
    speed: 28,
    bearing: 90,
    isDriving: true,
    isDeviceCommunicating: true,
    currentStateDuration: 'PT22M',
    driver: 'sarah_chen',
    odometer: 12150,
    engineHours: 320,
  },
  'Demo-17': {
    id: 'demo-17-id',
    name: 'Demo-17',
    latitude: I15_CORRIDOR.lat,
    longitude: I15_CORRIDOR.lng,
    speed: 62,
    bearing: 0,
    isDriving: true,
    isDeviceCommunicating: true,
    currentStateDuration: 'PT45M',
    driver: 'dave_kowalski',
    odometer: 128450,
    engineHours: 4520,
  },
  'Demo-19': {
    id: 'demo-19-id',
    name: 'Demo-19',
    latitude: SOUTH_LV.lat,
    longitude: SOUTH_LV.lng,
    speed: 0,
    bearing: 270,
    isDriving: false,
    isDeviceCommunicating: true,
    currentStateDuration: 'PT8M', // Short stop - probably legit
    driver: 'jt_thompson',
    odometer: 28900,
    engineHours: 760,
  },
};

export function getMockVehicleStatus(vehicleName: string): VehicleStatus | null {
  const lower = vehicleName.toLowerCase();

  // Handle various ways to refer to vehicles
  // "truck 3", "Demo-03", "demo 03", "mike", etc.
  for (const [key, vehicle] of Object.entries(mockVehicles)) {
    const keyLower = key.toLowerCase();
    const nameLower = vehicle.name.toLowerCase();

    // Direct match
    if (keyLower.includes(lower) || lower.includes(keyLower)) {
      return getUpdatedVehicle(vehicle);
    }

    // Number match ("truck 3" -> "Demo-03")
    const numMatch = lower.match(/\d+/);
    const vehicleNum = keyLower.match(/\d+/);
    if (numMatch && vehicleNum && numMatch[0] === vehicleNum[0]) {
      return getUpdatedVehicle(vehicle);
    }

    // Driver name match
    if (vehicle.driver && lower.includes(vehicle.driver.split('_')[0])) {
      return getUpdatedVehicle(vehicle);
    }
  }

  return null;
}

function getUpdatedVehicle(vehicle: VehicleStatus): VehicleStatus {
  // If this is Mike's truck and demo state says he started moving
  if (vehicle.name === 'Demo-03' && demoState.mikeStartedMoving) {
    return {
      ...vehicle,
      speed: 32,
      isDriving: true,
      currentStateDuration: 'PT2M',
    };
  }

  // Update Mike's stopped duration based on demo state
  if (vehicle.name === 'Demo-03') {
    return {
      ...vehicle,
      currentStateDuration: `PT${demoState.mikeStoppedMinutes}M`,
    };
  }

  return vehicle;
}

export function getMockFleetOverview(): FleetOverview {
  const vehicles = Object.values(mockVehicles).map((v) => {
    const updated = getUpdatedVehicle(v);
    return {
      name: updated.name,
      status: (updated.isDriving ? 'driving' : 'stopped') as 'driving' | 'stopped' | 'offline',
      speed: updated.speed,
      location: `${updated.latitude?.toFixed(4)}, ${updated.longitude?.toFixed(4)}`,
    };
  });

  const driving = vehicles.filter((v) => v.status === 'driving').length;
  const stopped = vehicles.filter((v) => v.status === 'stopped').length;

  return {
    total: vehicles.length,
    driving,
    stopped,
    offline: 0,
    vehicles,
  };
}

// Helper to update demo state (can be called via API endpoint)
export function setMikeMoving(moving: boolean): void {
  demoState.mikeStartedMoving = moving;
}

export function setMikeStoppedMinutes(minutes: number): void {
  demoState.mikeStoppedMinutes = minutes;
}
