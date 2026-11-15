"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { followRemote } from "../relay-client";
import type { LocationState } from "../sensors";

const PLACES_KEY = "vexo.places";
/** The device counts as being at a saved place within this distance of it. */
const PLACE_RADIUS_M = 75;
/** Moving further than this from where it settled ends a stationary spell. */
const STATIONARY_RADIUS_M = 15;
/** Slower than this counts as not moving; GPS speed is never exactly zero. */
const MOVING_KMH = 1.5;
/** Where the simulator starts: Union Square, San Francisco. */
const SIMULATOR_START = { latitude: 37.78795, longitude: -122.4075 };

export type Place = { name: string; latitude: number; longitude: number };
type Fix = { latitude: number; longitude: number; accuracy: number; speedKmh: number; at: number };

/** Distance between two points on the ground, in metres. */
function distanceM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/**
 * The saved places. One list for the whole page, so a place saved from one device's position
 * (this computer's, say) can be used in a rule about another's (a phone's).
 */
let savedPlaces: Place[] | null = null;
const placeListeners = new Set<() => void>();

function readPlaces(): Place[] {
  if (savedPlaces === null) {
    try {
      savedPlaces = JSON.parse(localStorage.getItem(PLACES_KEY) ?? "[]") as Place[];
    } catch {
      // Storage is unavailable or unreadable: start with no saved places.
      savedPlaces = [];
    }
  }
  return savedPlaces;
}

function writePlaces(next: Place[]): void {
  savedPlaces = next;
  try {
    localStorage.setItem(PLACES_KEY, JSON.stringify(next));
  } catch {
    // Storage is unavailable: places last for this page view only.
  }
  for (const listener of placeListeners) listener();
}

/**
 * Tracks where the device is, from its own GPS or a simulator. A reading holds how far it
 * has gone from where tracking began, its speed, and how it stands relative to saved places.
 */
export function useLocationSensor() {
  /** "remote" is another device's GPS, arriving through the relay. */
  const [source, setSource] = useState<"gps" | "simulator" | "remote" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<LocationState | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  /** Where the device was when tracking began. */
  const [origin, setOrigin] = useState<{ latitude: number; longitude: number } | null>(null);

  const stateRef = useRef<LocationState | null>(null);
  const placesRef = useRef<Place[]>([]);
  const track = useRef<{ start: Fix | null; last: Fix | null; settled: Fix | null }>({ start: null, last: null, settled: null });
  const stopRef = useRef<(() => void) | null>(null);

  /** The latest reading another device sent, before this computer's saved places are applied to it. */
  const remoteRef = useRef<LocationState | null>(null);

  const publish = useCallback(() => {
    const { start, last, settled } = track.current;
    if (!start || !last || !settled) return;
    const savedPlaces = placesRef.current.map((place) => ({ name: place.name, distance_m: Math.round(distanceM(last, place)) }));
    const next: LocationState = {
      distance_from_start_m: Math.round(distanceM(start, last)),
      speed_kmh: Math.round(last.speedKmh * 10) / 10,
      moving: last.speedKmh >= MOVING_KMH,
      // Counted in steps of ten seconds, so a parked device does not look like a new reading every second.
      seconds_stationary: Math.floor((Date.now() - settled.at) / 10_000) * 10,
      currently_at: savedPlaces.filter((place) => place.distance_m <= PLACE_RADIUS_M).map((place) => place.name),
      saved_places: savedPlaces,
      latitude: Number(last.latitude.toFixed(5)),
      longitude: Number(last.longitude.toFixed(5)),
      accuracy_m: Math.round(last.accuracy),
    };
    stateRef.current = next;
    setReading(next);
  }, []);

  /**
   * Takes a reading sent by another device, or null once it has gone quiet. Where that device
   * stands relative to the saved places is worked out here, since the places are this page's.
   */
  const applyRemote = useCallback((state: LocationState | null) => {
    remoteRef.current = state;
    // Kept as the latest position too, so "save this spot" works on the other device's position.
    track.current.last = state && { latitude: state.latitude, longitude: state.longitude, accuracy: state.accuracy_m, speedKmh: state.speed_kmh, at: Date.now() };
    const places = placesRef.current.map((place) => ({ name: place.name, distance_m: state ? Math.round(distanceM(state, place)) : 0 }));
    const here = state && { ...state, saved_places: places, currently_at: places.filter((place) => place.distance_m <= PLACE_RADIUS_M).map((place) => place.name) };
    stateRef.current = here;
    setReading(here);
  }, []);

  // Saved places survive a refresh, and a change made through any location source reaches this one.
  // Loaded after mount so server and client render the same first page.
  useEffect(() => {
    const refresh = () => {
      placesRef.current = readPlaces();
      setPlaces(placesRef.current);
      if (remoteRef.current) applyRemote(remoteRef.current);
      else publish();
    };
    refresh();
    placeListeners.add(refresh);
    return () => {
      placeListeners.delete(refresh);
    };
  }, [applyRemote, publish]);

  const accept = useCallback(
    (fix: Fix) => {
      const current = track.current;
      if (!current.start) {
        current.start = fix;
        setOrigin({ latitude: fix.latitude, longitude: fix.longitude });
      }
      current.last = fix;
      if (!current.settled || distanceM(current.settled, fix) > STATIONARY_RADIUS_M) current.settled = fix;
      publish();
    },
    [publish],
  );

  const disconnect = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    track.current = { start: null, last: null, settled: null };
    remoteRef.current = null;
    stateRef.current = null;
    setReading(null);
    setOrigin(null);
    setSource(null);
  }, []);

  const begin = useCallback(
    (kind: "gps" | "simulator", stop: () => void) => {
      // Refreshes the stationary time between fixes.
      const tick = setInterval(publish, 1000);
      stopRef.current = () => {
        clearInterval(tick);
        stop();
      };
      setSource(kind);
      setError(null);
    },
    [publish],
  );

  const connectGps = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("This browser cannot report its location.");
      return;
    }
    disconnect();
    let previous: Fix | null = null;
    const watch = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        const here = { latitude: coords.latitude, longitude: coords.longitude };
        // Some devices leave speed empty, so fall back to distance covered since the last fix.
        let speedKmh = coords.speed !== null ? coords.speed * 3.6 : 0;
        if (coords.speed === null && previous && timestamp > previous.at) {
          speedKmh = (distanceM(previous, here) / ((timestamp - previous.at) / 1000)) * 3.6;
        }
        previous = { ...here, accuracy: coords.accuracy, speedKmh, at: timestamp };
        setError(null);
        accept(previous);
      },
      (failure) => {
        if (failure.code === failure.PERMISSION_DENIED) {
          setError("Location access was blocked. Allow it in the browser and try again.");
          disconnect();
        } else if (!previous) {
          // Losing the signal for a moment is normal, indoors especially, so keep waiting for a fix.
          setError("Still looking for a position. This can take a while indoors.");
        }
      },
      { enableHighAccuracy: true, maximumAge: 1000 },
    );
    begin("gps", () => navigator.geolocation.clearWatch(watch));
  }, [accept, begin, disconnect]);

  /** Places the simulated device a distance north of its start, travelling at a speed. */
  const simulate = useCallback(
    (distanceFromStartM: number, speedKmh: number) => {
      accept({
        latitude: SIMULATOR_START.latitude + distanceFromStartM / 111_320,
        longitude: SIMULATOR_START.longitude,
        accuracy: 5,
        speedKmh,
        at: Date.now(),
      });
    },
    [accept],
  );

  const connectSimulator = useCallback(() => {
    disconnect();
    begin("simulator", () => {});
    simulate(0, 0);
  }, [begin, disconnect, simulate]);

  /** Replaces the saved places. Every location source on the page then republishes its reading with them. */
  const storePlaces = useCallback((next: Place[]) => writePlaces(next), []);

  /** Saves the device's current position under a name. Returns false when there is no position yet. */
  const savePlace = useCallback(
    (name: string): boolean => {
      const { last } = track.current;
      if (!last) return false;
      const place = { name, latitude: last.latitude, longitude: last.longitude };
      storePlaces([...placesRef.current.filter((item) => item.name !== name), place]);
      return true;
    },
    [storePlaces],
  );

  const removePlace = useCallback(
    (name: string) => storePlaces(placesRef.current.filter((item) => item.name !== name)),
    [storePlaces],
  );

  // Stops the source when the page goes away. A code reload during development can run this too
  // while keeping the state, so the source is also forgotten: better shown as off than as on and silent.
  useEffect(
    () => () => {
      stopRef.current?.();
      stopRef.current = null;
      setSource(null);
    },
    [],
  );

  /** Follows another device's position, such as a phone's, from the readings it sends through the relay. */
  const connectRemote = useCallback(
    (channel: string) => {
      disconnect();
      stopRef.current = followRemote<LocationState>(channel, "location", applyRemote);
      setSource("remote");
      setError(null);
    },
    [applyRemote, disconnect],
  );

  const getState = useCallback(() => stateRef.current, []);

  return {
    connected: source !== null,
    source,
    error,
    reading,
    origin,
    places,
    connectGps,
    connectRemote,
    connectSimulator,
    simulate,
    savePlace,
    removePlace,
    disconnect,
    getState,
  };
}
