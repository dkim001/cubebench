/** Thin client for our Express proxy. All WCA access goes through the backend. */

export type Competition = {
  id: string;
  name: string;
  city?: string;
  country_iso2?: string;
  start_date?: string;
  end_date?: string;
};

export type RoundScrambleSet = {
  available: boolean;
  reason?: string;
  roundTypeId?: string;
  roundName?: string;
  groupId?: string;
  scrambles?: string[];
};

export type RankingData = {
  roundTypeId: string;
  roundName: string;
  totalCompetitors: number;
  averagesAsc: number[];
  fastestAverage: number | null;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) detail = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export function searchCompetitions(query: string): Promise<{ competitions: Competition[] }> {
  return getJson(`/api/competitions?q=${encodeURIComponent(query)}`);
}

export function getRound(
  id: string,
): Promise<{ competition: Competition; round: RoundScrambleSet }> {
  return getJson(`/api/competitions/${encodeURIComponent(id)}/round`);
}

export async function submitEarlyAccess(email: string): Promise<void> {
  const res = await fetch("/api/early-access", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    let detail = "Something went wrong — please try again.";
    try {
      const body = await res.json();
      if (body?.error) detail = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
}

export function getRanking(
  id: string,
  roundTypeId: string,
): Promise<{ ranking: RankingData }> {
  return getJson(
    `/api/competitions/${encodeURIComponent(id)}/ranking?roundTypeId=${encodeURIComponent(roundTypeId)}`,
  );
}
