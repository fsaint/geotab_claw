import { config } from '../config';
import { getMockVehicleStatus, getMockFleetOverview } from './mock-data';

const API_URL = `https://${config.geotab.server}/apiv1`;

let sessionId: string | null = null;

interface GeotabResponse {
  result?: unknown;
  error?: {
    message?: string;
    errors?: Array<{ name?: string }>;
  };
}

async function authenticate(): Promise<void> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'Authenticate',
      params: {
        database: config.geotab.database,
        userName: config.geotab.username,
        password: config.geotab.password,
      },
    }),
  });
  const data = (await res.json()) as GeotabResponse & {
    result?: { credentials?: { sessionId?: string } };
  };
  if (data.error) throw new Error(`Geotab auth failed: ${JSON.stringify(data.error)}`);
  sessionId = data.result?.credentials?.sessionId || null;
}

async function geotabCall(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  if (!sessionId) await authenticate();

  const makeCall = async (): Promise<GeotabResponse> => {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method,
        params: {
          ...params,
          credentials: {
            database: config.geotab.database,
            sessionId,
            userName: config.geotab.username,
          },
        },
      }),
    });
    return (await res.json()) as GeotabResponse;
  };

  let data = await makeCall();
  if (
    data.error?.errors?.[0]?.name === 'InvalidUserException' ||
    data.error?.message?.includes('session')
  ) {
    await authenticate();
    data = await makeCall();
  }
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.result;
}

export interface VehicleStatus {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  bearing: number | null;
  isDriving: boolean;
  isDeviceCommunicating: boolean;
  currentStateDuration: string | null;
  driver: string | null;
  odometer: number | null;
  engineHours: number | null;
}

export async function getVehicleStatus(vehicleName: string): Promise<VehicleStatus | null> {
  // Use mock data in demo mode
  if (config.demoMode) {
    console.log(`[Geotab] Demo mode: returning mock data for "${vehicleName}"`);
    return getMockVehicleStatus(vehicleName);
  }

  const devices = (await geotabCall('Get', {
    typeName: 'Device',
    search: { name: `%${vehicleName}%` },
  })) as Array<{
    id: string;
    name: string;
    odometer?: number;
    engineHours?: number;
  }>;

  if (!devices.length) return null;
  const device = devices[0];

  const infos = (await geotabCall('Get', {
    typeName: 'DeviceStatusInfo',
    search: { deviceSearch: { id: device.id } },
  })) as Array<{
    latitude?: number;
    longitude?: number;
    speed?: number;
    bearing?: number;
    isDriving?: boolean;
    isDeviceCommunicating?: boolean;
    currentStateDuration?: string;
    driver?: { id: string };
  }>;

  const info = infos[0];
  return {
    id: device.id,
    name: device.name,
    latitude: info?.latitude ?? null,
    longitude: info?.longitude ?? null,
    speed: info?.speed ?? null,
    bearing: info?.bearing ?? null,
    isDriving: info?.isDriving ?? false,
    isDeviceCommunicating: info?.isDeviceCommunicating ?? false,
    currentStateDuration: info?.currentStateDuration ?? null,
    driver: info?.driver?.id !== 'UnknownDriverId' ? info?.driver?.id ?? null : null,
    odometer: device.odometer ?? null,
    engineHours: device.engineHours ?? null,
  };
}

export interface FleetOverview {
  total: number;
  driving: number;
  stopped: number;
  offline: number;
  vehicles: Array<{
    name: string;
    status: 'driving' | 'stopped' | 'offline';
    speed: number | null;
    location: string;
  }>;
}

export async function getFleetOverview(): Promise<FleetOverview> {
  // Use mock data in demo mode
  if (config.demoMode) {
    console.log('[Geotab] Demo mode: returning mock fleet overview');
    return getMockFleetOverview();
  }

  const [devices, statusInfos] = await Promise.all([
    geotabCall('Get', { typeName: 'Device' }) as Promise<Array<{ id: string; name: string }>>,
    geotabCall('Get', { typeName: 'DeviceStatusInfo' }) as Promise<
      Array<{
        device?: { id: string };
        isDriving?: boolean;
        isDeviceCommunicating?: boolean;
        speed?: number;
        latitude?: number;
        longitude?: number;
      }>
    >,
  ]);

  const infoMap = new Map(statusInfos.map((i) => [i.device?.id, i]));

  let driving = 0;
  let stopped = 0;
  let offline = 0;

  const vehicles = devices.map((d) => {
    const info = infoMap.get(d.id);
    let status: 'driving' | 'stopped' | 'offline';
    if (!info?.isDeviceCommunicating) {
      status = 'offline';
      offline++;
    } else if (info?.isDriving) {
      status = 'driving';
      driving++;
    } else {
      status = 'stopped';
      stopped++;
    }
    return {
      name: d.name,
      status,
      speed: info?.speed ?? null,
      location:
        info?.latitude && info?.longitude ? `${info.latitude.toFixed(4)}, ${info.longitude.toFixed(4)}` : 'Unknown',
    };
  });

  return {
    total: devices.length,
    driving,
    stopped,
    offline,
    vehicles,
  };
}

export async function getVehicleTrips(
  vehicleName: string,
  daysBack = 1
): Promise<
  Array<{
    start: string;
    stop: string;
    distance: number;
    drivingDuration: string;
    idleDuration: string;
  }>
> {
  const devices = (await geotabCall('Get', {
    typeName: 'Device',
    search: { name: `%${vehicleName}%` },
  })) as Array<{ id: string }>;

  if (!devices.length) return [];

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - daysBack);

  const trips = (await geotabCall('Get', {
    typeName: 'Trip',
    search: {
      deviceSearch: { id: devices[0].id },
      fromDate: fromDate.toISOString(),
      toDate: new Date().toISOString(),
    },
    resultsLimit: 50,
  })) as Array<{
    start: string;
    stop: string;
    distance: number;
    drivingDuration: string;
    idleDuration: string;
  }>;

  return trips.map((t) => ({
    start: t.start,
    stop: t.stop,
    distance: t.distance,
    drivingDuration: t.drivingDuration,
    idleDuration: t.idleDuration,
  }));
}
