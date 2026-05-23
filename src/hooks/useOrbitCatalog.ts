import { useCallback, useEffect, useMemo, useState } from "react";
import { demoCatalog } from "../data/demoCatalog";
import { propagateCatalog } from "../lib/orbitMath";
import type { CatalogPayload, ObjectImageResult, ObjectProfile, OrbitObject, PropagatedOrbitObject } from "../types";

const storageKey = "earth-orbital-watch-ai-catalog-v3";

export function useOrbitCatalog(provider: "celestrak" | "spacetrack", preset: string, limit: number) {
  const [catalog, setCatalog] = useState<OrbitObject[]>(demoCatalog);
  const [meta, setMeta] = useState<Omit<CatalogPayload, "objects">>({
    provider: "Demo",
    preset: "demo",
    groups: ["demo"],
    fetchedAt: new Date().toISOString(),
    objectCount: demoCatalog.length,
    errors: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCatalog() {
      setLoading(true);
      setError(null);

      const cached = readCachedCatalog(provider, preset, limit);
      if (cached) {
        setCatalog(cached.objects);
        setMeta(stripObjects(cached));
        setLoading(false);
      }

      try {
        const payload = await fetchCatalogWithFallback(provider, preset, limit, controller.signal);
        setCatalog(payload.objects);
        setMeta(stripObjects(payload));
        writeCachedCatalog(provider, preset, limit, payload);
      } catch (fetchError) {
        if (controller.signal.aborted) {
          return;
        }

        setError(null);

        if (!cached) {
          setCatalog(demoCatalog);
          setMeta({
            provider: "Demo",
            preset: "demo",
            groups: ["demo"],
            fetchedAt: new Date().toISOString(),
            objectCount: demoCatalog.length,
            errors: ["Using bundled demo objects until the serverless catalog is available."]
          });
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadCatalog();

    return () => controller.abort();
  }, [provider, preset, limit, reloadToken]);

  return {
    catalog,
    meta,
    loading,
    error,
    refresh
  };
}

async function fetchCatalogWithFallback(
  provider: "celestrak" | "spacetrack",
  preset: string,
  limit: number,
  signal: AbortSignal
) {
  const attempts = [
    { provider, preset, limit },
    ...(provider === "celestrak"
      ? [
          { provider, preset: "focused", limit: Math.min(limit, 5000) },
          { provider, preset: "focused", limit: Math.min(limit, 1500) }
        ]
      : [])
  ];
  let lastError: unknown = null;

  for (const attempt of attempts) {
    try {
      const payload = await fetchCatalogAttempt(attempt.provider, attempt.preset, attempt.limit, signal);
      if (payload.objects.length) return payload;
      lastError = new Error(payload.errors[0] ?? "The catalog response did not include tracked objects.");
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Catalog request failed.");
}

async function fetchCatalogAttempt(
  provider: "celestrak" | "spacetrack",
  preset: string,
  limit: number,
  signal: AbortSignal
) {
  const response = await fetch(`/api/orbit-catalog?provider=${provider}&preset=${preset}&limit=${limit}`, {
    signal
  });

  if (!response.ok) {
    throw new Error(`Catalog request failed with ${response.status}`);
  }

  return (await response.json()) as CatalogPayload;
}

export function usePropagatedCatalog(catalog: OrbitObject[], date: Date) {
  const bucketMs = catalog.length > 12000 ? 5000 : catalog.length > 3000 ? 2500 : 1000;
  const timeBucket = Math.floor(date.getTime() / bucketMs);

  return useMemo(() => propagateCatalog(catalog, new Date(timeBucket * bucketMs)), [catalog, timeBucket, bucketMs]);
}

export function useObjectProfile(noradId: string | null) {
  const [profile, setProfile] = useState<ObjectProfile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!noradId) {
      setProfile(null);
      return;
    }

    const selectedNoradId = noradId;
    const controller = new AbortController();

    async function loadProfile() {
      setLoading(true);

      try {
        const response = await fetch(`/api/object-profile?norad=${encodeURIComponent(selectedNoradId)}`, {
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Profile request failed with ${response.status}`);
        }

        setProfile((await response.json()) as ObjectProfile);
      } catch {
        if (!controller.signal.aborted) {
          setProfile(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadProfile();

    return () => controller.abort();
  }, [noradId]);

  return { profile, loading };
}

export function useObjectImage(object: PropagatedOrbitObject | null) {
  const [image, setImage] = useState<ObjectImageResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!object) {
      setImage(null);
      setLoading(false);
      return;
    }

    const selectedObject = object;
    const controller = new AbortController();

    async function loadImage() {
      setLoading(true);

      try {
        const params = new URLSearchParams({
          name: selectedObject.name,
          type: selectedObject.objectType,
          norad: selectedObject.noradId
        });
        const response = await fetch(`/api/object-image?${params.toString()}`, {
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Image lookup failed with ${response.status}`);
        }

        setImage((await response.json()) as ObjectImageResult);
      } catch (error) {
        if (!controller.signal.aborted) {
          setImage({
            title: null,
            pageUrl: null,
            imageUrl: null,
            extract: null,
            source: "none",
            error: error instanceof Error ? error.message : "Image lookup failed."
          });
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadImage();

    return () => controller.abort();
  }, [object?.noradId, object?.name, object?.objectType]);

  return { image, loading };
}

function readCachedCatalog(provider: string, preset: string, limit: number): CatalogPayload | null {
  try {
    const raw = localStorage.getItem(`${storageKey}:${provider}:${preset}:${limit}`);
    if (!raw) return null;

    const payload = JSON.parse(raw) as CatalogPayload & { cachedAt: number };
    if (Date.now() - payload.cachedAt > 1000 * 60 * 60 * 6) return null;

    return payload;
  } catch {
    return null;
  }
}

function writeCachedCatalog(provider: string, preset: string, limit: number, payload: CatalogPayload) {
  try {
    localStorage.setItem(
      `${storageKey}:${provider}:${preset}:${limit}`,
      JSON.stringify({
        ...payload,
        cachedAt: Date.now()
      })
    );
  } catch {
    return;
  }
}

function stripObjects(payload: CatalogPayload): Omit<CatalogPayload, "objects"> {
  return {
    provider: payload.provider,
    preset: payload.preset,
    groups: payload.groups,
    fetchedAt: payload.fetchedAt,
    objectCount: payload.objectCount,
    errors: payload.errors
  };
}
