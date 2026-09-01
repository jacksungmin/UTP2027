"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  ExternalLink,
  Filter,
  Layers,
  LocateFixed,
  MapPinned,
  Search,
  TableProperties,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const TXDOT_LAYER_URL =
  "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Projects_Info/FeatureServer/0";

const hgacCounties = [
  "Austin",
  "Brazoria",
  "Chambers",
  "Colorado",
  "Fort Bend",
  "Galveston",
  "Harris",
  "Liberty",
  "Matagorda",
  "Montgomery",
  "Walker",
  "Waller",
  "Wharton",
];

const phaseOptions = [
  "All phases",
  "Construction Underway or Begins Soon",
  "Construction begins within 4 years",
  "Construction begins in 5 to 10 years",
  "Planning, 10+ years",
  "Feasibility Studies",
];

const colorByPhase: Record<string, [number, number, number, number]> = {
  "Construction Underway or Begins Soon": [214, 26, 29, 0.9],
  "Construction begins within 4 years": [232, 126, 35, 0.9],
  "Construction begins in 5 to 10 years": [18, 133, 118, 0.9],
  "Planning, 10+ years": [82, 99, 125, 0.85],
  "Feasibility Studies": [0, 92, 230, 0.9],
};

type Summary = {
  count: number;
  totalCost: number;
  mpoCost: number;
  nonMpoCost: number;
  nearTermCount: number;
  counties: string[];
  corridors: string[];
  countyTotals: Array<[string, number]>;
  phaseTotals: Array<[string, number]>;
  projects: ProjectRecord[];
  lastUpdated: string | null;
};

type ArcGisFeatureAttributes = {
  OBJECTID?: number;
  CONTROL_SECT_JOB?: string;
  COUNTY_NAME?: string;
  DISTRICT_NAME?: string;
  HIGHWAY_NUMBER?: string;
  HWY_NBR?: string;
  LIMITS_FROM?: string;
  LIMITS_TO?: string;
  TYPE_OF_WORK?: string;
  PROJ_CLASS?: string;
  PROJ_STAT?: string;
  PROJ_STG?: string;
  PT_PHASE?: string;
  ESTMTD_FISCAL_YR?: number;
  EST_CONSTRUCTION_COST?: number;
  LAST_PROJ_UPDATE_DT?: number;
  MPO_NM?: string;
  PROJ_ID?: string;
};

type ProjectRecord = {
  objectId: number;
  csj: string;
  county: string;
  district: string;
  corridor: string;
  limits: string;
  work: string;
  phase: string;
  fiscalYear: number | null;
  cost: number;
  group: "8-county MPO" | "5-county non-MPO";
};

type QueryResponse = {
  features?: Array<{ attributes: ArcGisFeatureAttributes }>;
};

type ArcGisApi = {
  Map: new (args: Record<string, unknown>) => unknown;
  MapView: new (args: Record<string, unknown>) => {
    ui: { add: (widget: unknown, position: string) => void };
    when: () => Promise<void>;
    destroy: () => void;
  };
  FeatureLayer: new (args: Record<string, unknown>) => {
    definitionExpression: string;
    refresh: () => void;
    queryExtent: (query?: Record<string, unknown>) => Promise<{ extent?: unknown }>;
    queryFeatures: (query: Record<string, unknown>) => Promise<QueryResponse>;
  };
  Legend: new (args: Record<string, unknown>) => unknown;
  Expand: new (args: Record<string, unknown>) => unknown;
};

declare global {
  interface Window {
    require?: (modules: string[], callback: (...args: any[]) => void) => void;
  }
}

const countyWhere = `COUNTY_NAME IN (${hgacCounties.map((county) => `'${county}'`).join(",")})`;
const baseWhere = `PRJ_UTP = 1 AND ${countyWhere}`;
const mpoCounties = new Set([
  "Brazoria",
  "Chambers",
  "Fort Bend",
  "Galveston",
  "Harris",
  "Liberty",
  "Montgomery",
  "Waller",
]);

const currency = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});

function formatCurrency(value: number) {
  if (value >= 1_000_000_000) {
    return `$${currency.format(value / 1_000_000_000)}B`;
  }

  return `$${currency.format(value / 1_000_000)}M`;
}

function buildDefinition(county: string, phase: string, search: string) {
  const clauses = [baseWhere];

  if (county !== "All counties") {
    clauses.push(`COUNTY_NAME = '${county.replaceAll("'", "''")}'`);
  }

  if (phase !== "All phases") {
    clauses.push(`PT_PHASE = '${phase.replaceAll("'", "''")}'`);
  }

  const trimmed = search.trim().replaceAll("'", "''").toUpperCase();
  if (trimmed) {
    clauses.push(
      `(UPPER(HIGHWAY_NUMBER) LIKE '%${trimmed}%' OR UPPER(HWY_NBR) LIKE '%${trimmed}%' OR UPPER(CONTROL_SECT_JOB) LIKE '%${trimmed}%' OR UPPER(TYPE_OF_WORK) LIKE '%${trimmed}%' OR UPPER(LIMITS_FROM) LIKE '%${trimmed}%' OR UPPER(LIMITS_TO) LIKE '%${trimmed}%')`,
    );
  }

  return clauses.join(" AND ");
}

function arcgisRenderer() {
  return {
    type: "unique-value",
    field: "PT_PHASE",
    defaultSymbol: {
      type: "simple-line",
      color: [55, 65, 81, 0.75],
      width: 2.5,
    },
    uniqueValueInfos: Object.entries(colorByPhase).map(([value, color]) => ({
      value,
      label: value,
      symbol: {
        type: "simple-line",
        color,
        width: 4,
      },
    })),
  };
}

export default function Home() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<ArcGisApi["FeatureLayer"] | null>(null);
  const viewRef = useRef<ReturnType<ArcGisApi["MapView"]> | null>(null);
  const [county, setCounty] = useState("All counties");
  const [phase, setPhase] = useState("All phases");
  const [search, setSearch] = useState("");
  const [summary, setSummary] = useState<Summary>({
    count: 0,
    totalCost: 0,
    mpoCost: 0,
    nonMpoCost: 0,
    nearTermCount: 0,
    counties: [],
    corridors: [],
    countyTotals: [],
    phaseTotals: [],
    projects: [],
    lastUpdated: null,
  });
  const [mapStatus, setMapStatus] = useState("Loading TxDOT AGO layer");

  const definitionExpression = useMemo(
    () => buildDefinition(county, phase, search),
    [county, phase, search],
  );

  useEffect(() => {
    const stylesheetId = "arcgis-maps-sdk-css";
    const scriptId = "arcgis-maps-sdk-js";

    if (!document.getElementById(stylesheetId)) {
      const link = document.createElement("link");
      link.id = stylesheetId;
      link.rel = "stylesheet";
      link.href = "https://js.arcgis.com/4.33/esri/themes/light/main.css";
      document.head.appendChild(link);
    }

    const loadMap = () => {
      window.require?.(
        [
          "esri/Map",
          "esri/views/MapView",
          "esri/layers/FeatureLayer",
          "esri/widgets/Legend",
          "esri/widgets/Expand",
        ],
        (Map, MapView, FeatureLayer, Legend, Expand) => {
          if (!mapRef.current || viewRef.current) {
            return;
          }

          const layer = new FeatureLayer({
            url: TXDOT_LAYER_URL,
            title: "TxDOT UTP Projects",
            outFields: ["*"],
            definitionExpression,
            renderer: arcgisRenderer(),
            popupTemplate: {
              title: "{HIGHWAY_NUMBER} in {COUNTY_NAME} County",
              content: [
                {
                  type: "fields",
                  fieldInfos: [
                    { fieldName: "CONTROL_SECT_JOB", label: "CSJ" },
                    { fieldName: "TYPE_OF_WORK", label: "Type of work" },
                    { fieldName: "LIMITS_FROM", label: "From" },
                    { fieldName: "LIMITS_TO", label: "To" },
                    { fieldName: "PT_PHASE", label: "Project timing" },
                    { fieldName: "ESTMTD_FISCAL_YR", label: "Estimated fiscal year" },
                    {
                      fieldName: "EST_CONSTRUCTION_COST",
                      label: "Estimated construction cost",
                      format: { digitSeparator: true, places: 0 },
                    },
                    { fieldName: "DISTRICT_NAME", label: "TxDOT district" },
                    { fieldName: "MPO_NM", label: "MPO" },
                  ],
                },
              ],
            },
          });

          const map = new Map({
            basemap: "streets-vector",
            layers: [layer],
          });

          const view = new MapView({
            container: mapRef.current,
            map,
            center: [-95.35, 29.75],
            zoom: 8,
            constraints: {
              minZoom: 6,
            },
          });

          const legend = new Legend({ view, layerInfos: [{ layer, title: "UTP project timing" }] });
          const expand = new Expand({
            view,
            content: legend,
            expanded: false,
            expandTooltip: "Show legend",
          });

          view.ui.add(expand, "bottom-left");
          layerRef.current = layer;
          viewRef.current = view;

          view
            .when()
            .then(() => {
              setMapStatus("Live TxDOT AGO layer loaded");
              refreshLayerSummary(layer, definitionExpression, setSummary);
              zoomToLayer(layer, view, definitionExpression);
            })
            .catch(() => setMapStatus("The TxDOT AGO layer could not be loaded"));
        },
      );
    };

    if (window.require) {
      loadMap();
    } else if (!document.getElementById(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://js.arcgis.com/4.33/";
      script.async = true;
      script.onload = loadMap;
      document.body.appendChild(script);
    }

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    const view = viewRef.current;
    if (!layer || !view) {
      return;
    }

    layer.definitionExpression = definitionExpression;
    layer.refresh();
    refreshLayerSummary(layer, definitionExpression, setSummary);
    zoomToLayer(layer, view, definitionExpression);
  }, [definitionExpression]);

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-normal text-slate-950">
                H-GAC UTP Project Map
              </h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-700">
                View Unified Transportation Program projects from TxDOT Project Info for the 13-county H-GAC region.
              </p>
            </div>
            <a
              href={`${TXDOT_LAYER_URL}/query?outFields=*&where=1%3D1`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition hover:bg-muted"
            >
              Source layer <ExternalLink className="size-4" />
            </a>
          </div>

          <section className="grid gap-3 rounded-lg border bg-slate-50 p-3 lg:grid-cols-[1fr_1fr_1.4fr_auto]">
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              County
              <Select value={county} onValueChange={setCounty}>
                <SelectTrigger className="w-full bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All counties">All counties</SelectItem>
                  {hgacCounties.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Timing
              <Select value={phase} onValueChange={setPhase}>
                <SelectTrigger className="w-full bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {phaseOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Search
              <span className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Highway, CSJ, limits, or work type"
                  className="bg-white pl-8"
                />
              </span>
            </label>

            <Button
              type="button"
              variant="outline"
              className="self-end bg-white"
              onClick={() => {
                setCounty("All counties");
                setPhase("All phases");
                setSearch("");
              }}
            >
              <Filter /> Reset
            </Button>
          </section>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-4 lg:px-8">
        <Metric label="2027 UTP features" value={summary.count.toLocaleString()} detail="Live AGO records in view" />
        <Metric label="Estimated cost" value={formatCurrency(summary.totalCost)} detail="Construction cost total" />
        <Metric label="8-county MPO" value={formatCurrency(summary.mpoCost)} detail="Metropolitan counties" />
        <Metric label="Near-term projects" value={summary.nearTermCount.toLocaleString()} detail="FY 2027-2030" />
      </section>

      <section className="mx-auto grid w-full max-w-7xl flex-1 gap-4 px-4 pb-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
        <div className="grid content-start gap-4">
          <section className="overflow-hidden rounded-lg border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <MapPinned className="size-4 text-emerald-700" /> 2027 UTP Project Locations
              </h2>
              <Badge variant="secondary" className="rounded-md">
                {mapStatus}
              </Badge>
            </div>
            <div ref={mapRef} className="h-[620px] w-full" />
          </section>

          <ProjectList
            layer={layerRef.current}
            summary={summary}
            view={viewRef.current}
          />
        </div>

        <aside className="grid content-start gap-4">
          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Layers className="size-4 text-cyan-700" /> Current View
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <SmallMetric label="5 non-MPO" value={formatCurrency(summary.nonMpoCost)} />
              <SmallMetric label="Counties" value={summary.counties.length.toLocaleString()} />
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Counts and costs are queried from the TxDOT AGO layer using the active filters. This map intentionally excludes non-UTP records.
            </p>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <BarChart3 className="size-4 text-emerald-700" /> County Investment
            </h2>
            <div className="mt-4 space-y-3">
              {summary.countyTotals.slice(0, 7).map(([name, amount]) => (
                <div key={name}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">{name}</span>
                    <span className="text-muted-foreground">{formatCurrency(amount)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-emerald-700"
                      style={{
                        width: `${Math.max((amount / (summary.countyTotals[0]?.[1] || 1)) * 100, 4)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold">Counties In View</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {summary.counties.slice(0, 13).map((item) => (
                <Badge key={item} variant="outline" className="rounded-md">
                  {item}
                </Badge>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold">Project Timing</h2>
            <div className="mt-3 grid gap-2">
              {summary.phaseTotals.map(([item, amount]) => (
                <div key={item} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span>{item}</span>
                  <span className="font-medium">{formatCurrency(amount)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold">Common Corridors</h2>
            <div className="mt-3 grid gap-2">
              {summary.corridors.slice(0, 8).map((item) => (
                <button
                  key={item}
                  type="button"
                  className="rounded-md border px-3 py-2 text-left text-sm transition hover:bg-muted"
                  onClick={() => setSearch(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold">How To Use</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Pan or zoom the map, select a project line, and use the popup to review CSJ, limits, work type, timing, district, MPO, and estimated construction cost.
            </p>
            {summary.lastUpdated ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Layer update: {summary.lastUpdated}
              </p>
            ) : null}
          </section>
        </aside>
      </section>

    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <section className="rounded-lg border bg-white p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-normal">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </section>
  );
}

function ProjectList({
  layer,
  summary,
  view,
}: {
  layer: ArcGisApi["FeatureLayer"] | null;
  summary: Summary;
  view: ReturnType<ArcGisApi["MapView"]> | null;
}) {
  return (
    <section className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <TableProperties className="size-4 text-slate-700" /> 2027 UTP Project List
          </h2>
          <p className="text-sm text-muted-foreground">
            Select a project to zoom the map to its location. The list uses the same live AGO filter as the map.
          </p>
        </div>
        <Badge variant="outline" className="w-fit rounded-md">
          Showing top {Math.min(summary.projects.length, 60)} by cost
        </Badge>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Project</TableHead>
            <TableHead>County</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Work</TableHead>
            <TableHead>Timing</TableHead>
            <TableHead>FY</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">Map</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summary.projects.slice(0, 60).map((project) => (
            <TableRow key={project.objectId}>
              <TableCell>
                <div className="font-medium">{project.corridor}</div>
                <div className="font-mono text-xs text-muted-foreground">{project.csj}</div>
              </TableCell>
              <TableCell>{project.county}</TableCell>
              <TableCell className="max-w-[280px] whitespace-normal text-muted-foreground">
                {project.limits}
              </TableCell>
              <TableCell className="max-w-[240px] whitespace-normal">{project.work}</TableCell>
              <TableCell className="max-w-[220px] whitespace-normal text-muted-foreground">
                {project.phase}
              </TableCell>
              <TableCell>{project.fiscalYear ?? "N/A"}</TableCell>
              <TableCell className="text-right font-semibold">{formatCurrency(project.cost)}</TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => zoomToProject(project.objectId, layer, view)}
                >
                  <LocateFixed /> Zoom
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-normal">{value}</p>
    </div>
  );
}

async function refreshLayerSummary(
  layer: ArcGisApi["FeatureLayer"],
  where: string,
  setSummary: (summary: Summary) => void,
) {
  const response = await layer.queryFeatures({
    where,
    outFields: [
      "OBJECTID",
      "CONTROL_SECT_JOB",
      "COUNTY_NAME",
      "DISTRICT_NAME",
      "HIGHWAY_NUMBER",
      "HWY_NBR",
      "LIMITS_FROM",
      "LIMITS_TO",
      "TYPE_OF_WORK",
      "PROJ_CLASS",
      "PROJ_STAT",
      "PROJ_STG",
      "PT_PHASE",
      "ESTMTD_FISCAL_YR",
      "EST_CONSTRUCTION_COST",
      "LAST_PROJ_UPDATE_DT",
      "MPO_NM",
      "PROJ_ID",
    ],
    returnGeometry: false,
    num: 2000,
  });

  const attributes = response.features?.map((feature) => feature.attributes) ?? [];
  const counties = uniqueSorted(attributes.map((item) => item.COUNTY_NAME).filter(Boolean));
  const corridors = topValues(
    attributes.map((item) => item.HIGHWAY_NUMBER || item.HWY_NBR).filter(Boolean),
  );
  const projects = attributes.map(toProjectRecord).sort((a, b) => b.cost - a.cost);
  const totalCost = attributes.reduce(
    (sum, item) => sum + Number(item.EST_CONSTRUCTION_COST ?? 0),
    0,
  );
  const mpoCost = projects
    .filter((project) => project.group === "8-county MPO")
    .reduce((sum, project) => sum + project.cost, 0);
  const nonMpoCost = totalCost - mpoCost;
  const nearTermCount = projects.filter(
    (project) => project.fiscalYear !== null && project.fiscalYear <= 2030,
  ).length;
  const countyTotals = groupAmount(projects, "county");
  const phaseTotals = groupAmount(projects, "phase");
  const latestUpdate = Math.max(
    ...attributes.map((item) => Number(item.LAST_PROJ_UPDATE_DT ?? 0)),
    0,
  );

  setSummary({
    count: attributes.length,
    totalCost,
    mpoCost,
    nonMpoCost,
    nearTermCount,
    counties,
    corridors,
    countyTotals,
    phaseTotals,
    projects,
    lastUpdated: latestUpdate ? new Date(latestUpdate).toLocaleDateString() : null,
  });
}

function toProjectRecord(attributes: ArcGisFeatureAttributes): ProjectRecord {
  const county = attributes.COUNTY_NAME || "Unknown";
  const from = attributes.LIMITS_FROM || "Unknown";
  const to = attributes.LIMITS_TO || "Unknown";

  return {
    objectId: Number(attributes.OBJECTID),
    csj: attributes.CONTROL_SECT_JOB || "N/A",
    county,
    district: attributes.DISTRICT_NAME || "Unknown",
    corridor: attributes.HIGHWAY_NUMBER || attributes.HWY_NBR || "Unknown",
    limits: `${from} to ${to}`,
    work: attributes.TYPE_OF_WORK || attributes.PROJ_CLASS || "Unspecified",
    phase: attributes.PT_PHASE || "Unspecified",
    fiscalYear: attributes.ESTMTD_FISCAL_YR ?? null,
    cost: Number(attributes.EST_CONSTRUCTION_COST ?? 0),
    group: mpoCounties.has(county) ? "8-county MPO" : "5-county non-MPO",
  };
}

async function zoomToLayer(
  layer: ArcGisApi["FeatureLayer"],
  view: ReturnType<ArcGisApi["MapView"]>,
  where: string,
) {
  const result = await layer.queryExtent({ where });
  if (result.extent) {
    (view as any).goTo(result.extent, { duration: 450 }).catch(() => undefined);
  }
}

async function zoomToProject(
  objectId: number,
  layer: ArcGisApi["FeatureLayer"] | null,
  view: ReturnType<ArcGisApi["MapView"]> | null,
) {
  if (!layer || !view) {
    return;
  }

  const where = `OBJECTID = ${objectId}`;
  const extentResult = await layer.queryExtent({ where });
  if (extentResult.extent) {
    await (view as any).goTo(extentResult.extent, { duration: 500 }).catch(() => undefined);
  }

  const featureResult = await layer.queryFeatures({
    where,
    outFields: ["*"],
    returnGeometry: true,
  });
  const feature = featureResult.features?.[0];
  if (feature) {
    (view as any).popup.open({
      features: [feature],
      location: (feature as any).geometry?.extent?.center ?? (feature as any).geometry,
    });
  }
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function topValues(values: string[]) {
  const counts = values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([value]) => value);
}

function groupAmount(projects: ProjectRecord[], key: "county" | "phase") {
  const totals = projects.reduce<Record<string, number>>((acc, project) => {
    const value = project[key] || "Unspecified";
    acc[value] = (acc[value] ?? 0) + project.cost;
    return acc;
  }, {});

  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}
