"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Filter, Layers, MapPinned, Search } from "lucide-react";

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
  counties: string[];
  corridors: string[];
  lastUpdated: string | null;
};

type ArcGisFeatureAttributes = {
  COUNTY_NAME?: string;
  HIGHWAY_NUMBER?: string;
  HWY_NBR?: string;
  PT_PHASE?: string;
  EST_CONSTRUCTION_COST?: number;
  LAST_PROJ_UPDATE_DT?: number;
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
    queryExtent: () => Promise<{ extent?: unknown }>;
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
    counties: [],
    corridors: [],
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
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="outline" className="rounded-md border-emerald-200 bg-emerald-50 text-emerald-800">
                  Live TxDOT AGO layer
                </Badge>
                <span>Filtered to PRJ_UTP = 1</span>
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal text-slate-950">
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

      <section className="mx-auto grid w-full max-w-7xl flex-1 gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-8">
        <section className="min-h-[660px] overflow-hidden rounded-lg border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <MapPinned className="size-4 text-emerald-700" /> UTP Projects
            </h2>
            <Badge variant="secondary" className="rounded-md">
              {mapStatus}
            </Badge>
          </div>
          <div ref={mapRef} className="h-[620px] w-full" />
        </section>

        <aside className="grid content-start gap-4">
          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Layers className="size-4 text-cyan-700" /> Current View
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Metric label="UTP features" value={summary.count.toLocaleString()} />
              <Metric label="Est. cost" value={formatCurrency(summary.totalCost)} />
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Counts and costs are queried from the TxDOT AGO layer using the active filters. This map intentionally excludes non-UTP records.
            </p>
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

function Metric({ label, value }: { label: string; value: string }) {
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
      "COUNTY_NAME",
      "HIGHWAY_NUMBER",
      "HWY_NBR",
      "EST_CONSTRUCTION_COST",
      "LAST_PROJ_UPDATE_DT",
    ],
    returnGeometry: false,
    num: 2000,
  });

  const attributes = response.features?.map((feature) => feature.attributes) ?? [];
  const counties = uniqueSorted(attributes.map((item) => item.COUNTY_NAME).filter(Boolean));
  const corridors = topValues(
    attributes.map((item) => item.HIGHWAY_NUMBER || item.HWY_NBR).filter(Boolean),
  );
  const totalCost = attributes.reduce(
    (sum, item) => sum + Number(item.EST_CONSTRUCTION_COST ?? 0),
    0,
  );
  const latestUpdate = Math.max(
    ...attributes.map((item) => Number(item.LAST_PROJ_UPDATE_DT ?? 0)),
    0,
  );

  setSummary({
    count: attributes.length,
    totalCost,
    counties,
    corridors,
    lastUpdated: latestUpdate ? new Date(latestUpdate).toLocaleDateString() : null,
  });
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
