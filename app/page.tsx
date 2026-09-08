"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  ExternalLink,
  Filter,
  Layers,
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

import listedProjectsData from "@/lib/utp-2027-listed-projects.json";

// The project list, filters, and stats below are all sourced from TxDOT's
// official "2027 UTP - Listed Projects" document (see
// scripts/build-utp-listed-projects.js for how lib/utp-2027-listed-projects.json
// is generated). Map geometry comes from a standalone GeoJSON extracted from
// TxDOT's and H-GAC's live GIS services (see scripts/build-project-geometry.js) -
// there is no live GIS dependency at runtime.
const listedProjects = listedProjectsData as ListedProject[];

const UTP_DOCUMENT_URL = "https://ftp.txdot.gov/pub/txdot/get-involved/tpp/utp/2027utp.pdf";

// Standalone GeoJSON extracted from TxDOT's and H-GAC's live GIS services by
// scripts/build-project-geometry.js - see that script for how these are
// generated and re-run it whenever lib/utp-2027-listed-projects.json changes.
// The map no longer queries any live ArcGIS service at runtime.
const PROJECT_GEOMETRY_URL = "/utp-2027-project-geometry.geojson";
const COUNTY_BOUNDARY_GEOJSON_URL = "/hgac-county-boundaries.geojson";

const hgacCounties = [
  "Brazoria",
  "Chambers",
  "Fort Bend",
  "Galveston",
  "Harris",
  "Liberty",
  "Montgomery",
  "Waller",
];

const timingRanges = uniqueSorted(listedProjects.map((project) => project.estLetDateRange));
const timingOptions = ["All timing", ...timingRanges];
const nearTermRange = timingRanges[0] ?? null;

// Line color keyed on the document's own estLetDateRange field (the same
// field the Timing filter uses), rather than a GIS-only phase attribute.
// Colors are assigned by sorted order so this stays correct even if a future
// UTP document introduces a different set of ranges.
const TIMING_COLOR_PALETTE: Array<[number, number, number, number]> = [
  [232, 126, 35, 0.9],
  [18, 133, 118, 0.9],
  [82, 99, 125, 0.9],
  [0, 92, 230, 0.9],
];
const colorByTiming: Record<string, [number, number, number, number]> = Object.fromEntries(
  timingRanges.map((range, index) => [range, TIMING_COLOR_PALETTE[index % TIMING_COLOR_PALETTE.length]]),
);

type ListedProject = {
  district: string;
  highway: string;
  csj: string;
  estLetDateRange: string;
  county: string;
  limitsFrom: string;
  limitsTo: string;
  utpAction: string;
  estConstructionCost: number;
  fundingCategory2: number;
  fundingCategory4: number;
  fundingCategory12: number;
};

// TxDOT organizes the UTP into 12 prescribed funding categories; only these
// three ever have a nonzero amount among the H-GAC listed projects (source:
// https://ftp.txdot.gov/pub/txdot/get-involved/tpp/utp/utp_funding_categories_descriptions.pdf).
const fundingCategories = [
  {
    key: "fundingCategory2" as const,
    name: "Category 2 - Metropolitan and Urban Corridor Projects",
    description:
      "Mobility and added-capacity projects on urban corridors to reduce congestion. Funds are allocated to each MPO by formula, and the MPO selects and scores the projects.",
  },
  {
    key: "fundingCategory4" as const,
    name: "Category 4 - Statewide Connectivity Corridor Projects",
    description:
      "Mobility on major state highway corridors connecting urban areas to the statewide network - the Texas Trunk System, National Highway System, seaports, border crossings, freight routes, and hurricane evacuation routes.",
  },
  {
    key: "fundingCategory12" as const,
    name: "Category 12 - Strategic Priority",
    description:
      "Discretionary funding for projects of special statewide importance - congestion, economic opportunity, energy access, border/port connectivity, military readiness, or emergency response - awarded directly by the Texas Transportation Commission.",
  },
];

type ProjectRecord = ListedProject;

type Summary = {
  count: number;
  totalCost: number;
  nearTermCount: number;
  counties: string[];
  districts: string[];
  corridors: string[];
  countyTotals: Array<[string, number]>;
  timingTotals: Array<[string, number]>;
  fundingCategoryTotals: Record<string, number>;
};

// Properties on our own standalone GeoJSON features (see
// scripts/build-project-geometry.js), not raw ArcGIS attributes.
type ProjectGeometryProperties = {
  csj?: string;
  highway?: string;
  county?: string;
  estLetDateRange?: string;
};

type QueryResponse = {
  features?: Array<{ attributes: ProjectGeometryProperties }>;
};

type ArcGisApi = {
  Map: new (args: Record<string, unknown>) => unknown;
  MapView: new (args: Record<string, unknown>) => {
    ui: { add: (widget: unknown, position: string) => void };
    when: () => Promise<void>;
    destroy: () => void;
  };
  GeoJSONLayer: new (args: Record<string, unknown>) => {
    definitionExpression: string;
    refresh: () => void;
    queryExtent: (query?: Record<string, unknown>) => Promise<{ extent?: unknown }>;
    queryFeatures: (query: Record<string, unknown>) => Promise<QueryResponse>;
  };
  Legend: new (args: Record<string, unknown>) => unknown;
  Expand: new (args: Record<string, unknown>) => unknown;
  Home: new (args: Record<string, unknown>) => unknown;
};

declare global {
  interface Window {
    require?: (modules: string[], callback: (...args: any[]) => void) => void;
  }
}

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

// The document's CSJ is formatted with dashes (e.g. "1024-01-077"); the GIS
// layer's CONTROL_SECT_JOB field stores the same number without them.
function toGisCsj(csj: string) {
  return csj.replaceAll("-", "");
}

function csjFromFeatureAttributes(attributes: ProjectGeometryProperties | undefined | null) {
  return typeof attributes?.csj === "string" && attributes.csj ? attributes.csj : null;
}

function findListedProjectByCsj(csj: string | null) {
  if (!csj) {
    return null;
  }
  const normalized = toGisCsj(csj);
  return listedProjects.find((project) => toGisCsj(project.csj) === normalized) ?? null;
}

// Popup content for the project layer is built from our own document data
// (by looking up the clicked feature's csj) instead of the standalone
// geometry file's minimal properties, so popups always show full detail
// (funding categories, UTP action, etc.), not just the fields baked into
// the geometry file for rendering/filtering.
function buildProjectPopupHtml(project: ListedProject) {
  const fundingRows = fundingCategories
    .filter((category) => project[category.key] > 0)
    .map(
      (category) =>
        `<div style="display:flex;justify-content:space-between;gap:12px;"><span>${category.name.split(" - ")[0]}</span><span>${formatCurrency(project[category.key])}</span></div>`,
    )
    .join("");

  return `<div style="display:grid;gap:6px;font-size:13px;line-height:1.5;min-width:220px;">
    <div><strong>CSJ:</strong> ${project.csj}</div>
    <div><strong>District:</strong> ${project.district}</div>
    <div><strong>Limits:</strong> ${project.limitsFrom} to ${project.limitsTo}</div>
    <div><strong>UTP Action:</strong> ${project.utpAction}</div>
    <div><strong>Est. Let Date Range:</strong> ${project.estLetDateRange}</div>
    <div><strong>Est. Construction Cost:</strong> ${formatCurrency(project.estConstructionCost)}</div>
    ${fundingRows ? `<div style="margin-top:2px;"><strong>Funding categories:</strong></div>${fundingRows}` : ""}
  </div>`;
}

function popupContent(event: { graphic?: { attributes?: ProjectGeometryProperties } }) {
  const project = findListedProjectByCsj(csjFromFeatureAttributes(event.graphic?.attributes));
  return project
    ? buildProjectPopupHtml(project)
    : "<p>No matching 2027 UTP listed project found for this feature.</p>";
}

function filterProjects(
  projects: ListedProject[],
  county: string,
  timing: string,
  search: string,
  corridor: string | null,
  fundingCategory: (typeof fundingCategories)[number]["key"] | "All categories",
) {
  const trimmed = search.trim().toLowerCase();

  return projects.filter((project) => {
    if (county !== "All counties" && project.county !== county) {
      return false;
    }

    if (timing !== "All timing" && project.estLetDateRange !== timing) {
      return false;
    }

    // Common Corridors buttons filter on the project (highway) field only,
    // unlike the free-text search box below which matches several fields.
    if (corridor && project.highway !== corridor) {
      return false;
    }

    if (fundingCategory !== "All categories" && project[fundingCategory] <= 0) {
      return false;
    }

    if (trimmed) {
      const haystack =
        `${project.highway} ${project.csj} ${project.limitsFrom} ${project.limitsTo} ${project.utpAction}`.toLowerCase();
      if (!haystack.includes(trimmed)) {
        return false;
      }
    }

    return true;
  });
}

function buildSummary(projects: ListedProject[]): Summary {
  const counties = uniqueSorted(projects.map((project) => project.county));
  const districts = uniqueSorted(projects.map((project) => project.district).filter(Boolean));
  const corridors = topValues(projects.map((project) => project.highway).filter(Boolean));
  const totalCost = projects.reduce((sum, project) => sum + project.estConstructionCost, 0);
  const nearTermCount = projects.filter((project) => project.estLetDateRange === nearTermRange).length;
  const countyTotals = groupAmount(projects, "county");
  const timingTotals = groupAmount(projects, "estLetDateRange");
  const fundingCategoryTotals = Object.fromEntries(
    fundingCategories.map(({ key }) => [key, projects.reduce((sum, project) => sum + project[key], 0)]),
  );

  return {
    count: projects.length,
    totalCost,
    nearTermCount,
    counties,
    districts,
    corridors,
    countyTotals,
    timingTotals,
    fundingCategoryTotals,
  };
}

// Filters the standalone geometry layer down to the currently filtered
// projects, by the same dashed csj the document and the geometry file both
// use - no undashed conversion needed here (that's only for zoomToProject's
// on-demand lookups, kept for robustness against future format drift).
function buildMapWhere(projects: ListedProject[]) {
  const csjs = projects.map((project) => project.csj).filter(Boolean);
  return csjs.length
    ? `csj IN (${csjs.map((csj) => `'${csj.replaceAll("'", "''")}'`).join(",")})`
    : "1=0";
}

function arcgisRenderer() {
  return {
    type: "unique-value",
    field: "estLetDateRange",
    uniqueValueInfos: Object.entries(colorByTiming).map(([value, color]) => ({
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
  const layerRef = useRef<ArcGisApi["GeoJSONLayer"] | null>(null);
  const viewRef = useRef<ReturnType<ArcGisApi["MapView"]> | null>(null);
  const [county, setCounty] = useState("All counties");
  const [timing, setTiming] = useState("All timing");
  const [search, setSearch] = useState("");
  const [corridorFilter, setCorridorFilter] = useState<string | null>(null);
  const [fundingCategory, setFundingCategory] = useState<
    (typeof fundingCategories)[number]["key"] | "All categories"
  >("All categories");
  const [mapStatus, setMapStatus] = useState("Loading project geometry");

  const filteredProjects = useMemo(
    () => filterProjects(listedProjects, county, timing, search, corridorFilter, fundingCategory),
    [county, timing, search, corridorFilter, fundingCategory],
  );

  const summary = useMemo(() => buildSummary(filteredProjects), [filteredProjects]);

  const tableProjects = useMemo(
    () => filteredProjects.slice().sort((a, b) => b.estConstructionCost - a.estConstructionCost),
    [filteredProjects],
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
          "esri/layers/GeoJSONLayer",
          "esri/widgets/Legend",
          "esri/widgets/Expand",
          "esri/widgets/Home",
        ],
        (Map, MapView, GeoJSONLayer, Legend, Expand, Home) => {
          if (!mapRef.current || viewRef.current) {
            return;
          }

          const countyLayer = new GeoJSONLayer({
            url: COUNTY_BOUNDARY_GEOJSON_URL,
            title: "H-GAC County Boundaries",
            outFields: ["name"],
            popupTemplate: { title: "{name} County" },
            renderer: {
              type: "simple",
              symbol: {
                type: "simple-fill",
                color: [0, 0, 0, 0],
                outline: { color: [71, 85, 105, 0.55], width: 1.25 },
              },
            },
            labelingInfo: [
              {
                symbol: {
                  type: "text",
                  color: [71, 85, 105, 0.85],
                  haloColor: "#f8fafc",
                  haloSize: 1,
                  font: { size: 9, family: "sans-serif" },
                },
                labelPlacement: "always-horizontal",
                labelExpressionInfo: { expression: "$feature.name" },
              },
            ],
          });

          const layer = new GeoJSONLayer({
            url: PROJECT_GEOMETRY_URL,
            title: "TxDOT 2027 UTP Listed Projects",
            outFields: ["*"],
            definitionExpression: buildMapWhere(filteredProjects),
            renderer: arcgisRenderer(),
            popupTemplate: {
              title: "{highway} in {county} County",
              content: popupContent,
            },
          });

          const map = new Map({
            basemap: "gray-vector",
            layers: [countyLayer, layer],
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
          const home = new Home({ view });

          view.ui.add(expand, "bottom-left");
          view.ui.add(home, "top-left");
          layerRef.current = layer;
          viewRef.current = view;

          view
            .when()
            .then(() => {
              setMapStatus("Project geometry loaded");
              zoomToLayer(layer, view, layer.definitionExpression).catch(() => undefined);
            })
            .catch(() => setMapStatus("The project geometry could not be loaded"));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    const view = viewRef.current;
    if (!layer || !view) {
      return;
    }

    const mapWhere = buildMapWhere(filteredProjects);
    layer.definitionExpression = mapWhere;
    layer.refresh();
    zoomToLayer(layer, view, mapWhere).catch(() => undefined);
  }, [filteredProjects]);

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
                {listedProjects.length} projects individually listed in TxDOT&apos;s 2027 Unified
                Transportation Program for the 8-county H-GAC MPO region.
              </p>
            </div>
            <a
              href={UTP_DOCUMENT_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition hover:bg-muted"
            >
              Source document <ExternalLink className="size-4" />
            </a>
          </div>

          <section className="grid gap-3 rounded-lg border bg-slate-50 p-3 lg:grid-cols-[1fr_1fr_1fr_1.3fr_auto]">
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
              <Select value={timing} onValueChange={setTiming}>
                <SelectTrigger className="w-full bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timingOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Funding Category
              <Select
                value={fundingCategory}
                onValueChange={(value) => setFundingCategory(value as typeof fundingCategory)}
              >
                <SelectTrigger className="w-full bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All categories">All categories</SelectItem>
                  {fundingCategories.map((category) => (
                    <SelectItem key={category.key} value={category.key} title={category.description}>
                      {category.name.split(" - ")[0]}
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
                  placeholder="Highway, CSJ, limits, or UTP action"
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
                setTiming("All timing");
                setSearch("");
                setCorridorFilter(null);
                setFundingCategory("All categories");
              }}
            >
              <Filter /> Reset
            </Button>
          </section>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-3 lg:px-8">
        <Metric
          label="2027 UTP features"
          value={summary.count.toLocaleString()}
          detail="Listed in the 2027 UTP document"
        />
        <Metric label="Estimated cost" value={formatCurrency(summary.totalCost)} detail="Construction cost total" />
        <Metric
          label="Near-term projects"
          value={summary.nearTermCount.toLocaleString()}
          detail={nearTermRange ?? "N/A"}
        />
      </section>

      <section className="mx-auto grid w-full max-w-7xl flex-1 gap-4 overflow-hidden px-4 pb-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
        <div className="grid min-w-0 content-start gap-4 overflow-hidden">
          <section className="isolate min-w-0 overflow-hidden rounded-lg border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <MapPinned className="size-4 text-emerald-700" /> 2027 UTP Project Locations
              </h2>
              <Badge variant="secondary" className="rounded-md">
                {mapStatus}
              </Badge>
            </div>
            <div ref={mapRef} className="h-[620px] w-full min-w-0 max-w-full overflow-hidden" />
          </section>

          <ProjectList
            projects={tableProjects}
            layer={layerRef.current}
            view={viewRef.current}
          />
        </div>

        <aside className="relative z-10 grid min-w-0 content-start gap-4">
          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Layers className="size-4 text-cyan-700" /> Current View
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <SmallMetric label="Counties" value={summary.counties.length.toLocaleString()} />
              <SmallMetric label="Districts" value={summary.districts.length.toLocaleString()} />
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Counts and costs come from TxDOT&apos;s 2027 UTP Listed Projects document using the
              active filters. Map geometry is a standalone extract, not a live GIS query.
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
                <Badge
                  key={item}
                  variant="outline"
                  render={<button type="button" aria-pressed={county === item} />}
                  className={`cursor-pointer rounded-md transition ${
                    county === item ? "border-emerald-600 bg-emerald-50" : "hover:bg-muted"
                  }`}
                  onClick={() => setCounty(county === item ? "All counties" : item)}
                >
                  {item}
                </Badge>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold">Est. Let Date Range</h2>
            <div className="mt-3 grid gap-2">
              {summary.timingTotals.map(([item, amount]) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={timing === item}
                  className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition ${
                    timing === item ? "border-emerald-600 bg-emerald-50" : "hover:bg-muted"
                  }`}
                  onClick={() => setTiming(timing === item ? "All timing" : item)}
                >
                  <span>{item}</span>
                  <span className="font-medium">{formatCurrency(amount)}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold">Funding Categories</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              TxDOT organizes the UTP into 12 prescribed funding categories; only these three
              apply to H-GAC listed projects.
            </p>
            <div className="mt-3 grid gap-3">
              {fundingCategories.map((category) => (
                <button
                  key={category.key}
                  type="button"
                  aria-pressed={fundingCategory === category.key}
                  className={`rounded-md border px-3 py-2 text-left transition ${
                    fundingCategory === category.key
                      ? "border-emerald-600 bg-emerald-50"
                      : "hover:bg-muted"
                  }`}
                  onClick={() =>
                    setFundingCategory(fundingCategory === category.key ? "All categories" : category.key)
                  }
                >
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">{category.name}</span>
                    <span className="font-medium whitespace-nowrap">
                      {formatCurrency(summary.fundingCategoryTotals[category.key] ?? 0)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{category.description}</p>
                </button>
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
                  aria-pressed={item === corridorFilter}
                  className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                    item === corridorFilter
                      ? "border-emerald-600 bg-emerald-50"
                      : "hover:bg-muted"
                  }`}
                  onClick={() => setCorridorFilter(item === corridorFilter ? null : item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold">How To Use</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Pan or zoom the map, select a project line, and use the popup to review CSJ,
              district, limits, UTP action, est. let date range, cost, and funding categories from
              the 2027 UTP document.
            </p>
          </section>
        </aside>
      </section>

      <footer className="border-t bg-white">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-4 py-6 text-center sm:px-6 lg:px-8">
          <img src="/hgac-logo.png" alt="Houston-Galveston Area Council" className="h-16 w-16" />
          <p className="text-xs text-muted-foreground">
            Houston-Galveston Area Council (H-GAC) &middot; TxDOT 2027 Unified Transportation
            Program explorer
          </p>
        </div>
      </footer>
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
  projects,
  layer,
  view,
}: {
  projects: ProjectRecord[];
  layer: ArcGisApi["GeoJSONLayer"] | null;
  view: ReturnType<ArcGisApi["MapView"]> | null;
}) {
  const [selectedCsj, setSelectedCsj] = useState<string | null>(null);
  const [unavailableCsj, setUnavailableCsj] = useState<string | null>(null);

  return (
    <section className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <TableProperties className="size-4 text-slate-700" /> 2027 UTP Project List
          </h2>
          <p className="text-sm text-muted-foreground">
            Select a row to zoom the map to its location; select it again to deselect. The list
            uses the same filters as the map.
          </p>
          {unavailableCsj ? (
            <p className="mt-1 text-sm text-amber-700">
              No map location found for {unavailableCsj} in the standalone project geometry file -
              re-run scripts/build-project-geometry.js if this project was added recently.
            </p>
          ) : null}
        </div>
        <Badge variant="outline" className="w-fit rounded-md">
          Showing all {projects.length} listed project{projects.length === 1 ? "" : "s"}
        </Badge>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Project</TableHead>
            <TableHead>County</TableHead>
            <TableHead>District</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>UTP Action</TableHead>
            <TableHead>Timing</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((project) => (
            <TableRow
              key={project.csj}
              aria-selected={project.csj === selectedCsj}
              className={`cursor-pointer ${project.csj === selectedCsj ? "bg-emerald-50" : "hover:bg-muted/50"}`}
              onClick={() => {
                if (project.csj === selectedCsj) {
                  setSelectedCsj(null);
                  setUnavailableCsj(null);
                  if (layer && view) {
                    zoomToLayer(layer, view, layer.definitionExpression).catch(() => undefined);
                  }
                  return;
                }

                setSelectedCsj(project.csj);
                setUnavailableCsj(null);
                zoomToProject(project.csj, layer, view)
                  .then((found) => {
                    if (!found) {
                      setUnavailableCsj(project.csj);
                    }
                  })
                  .catch(() => setUnavailableCsj(project.csj));
              }}
            >
              <TableCell>
                <div className="font-medium">{project.highway}</div>
                <div className="font-mono text-xs text-muted-foreground">{project.csj}</div>
              </TableCell>
              <TableCell>{project.county}</TableCell>
              <TableCell className="text-muted-foreground">{project.district}</TableCell>
              <TableCell className="max-w-[240px] whitespace-normal text-muted-foreground">
                {project.limitsFrom} to {project.limitsTo}
              </TableCell>
              <TableCell className="max-w-[200px] whitespace-normal">{project.utpAction}</TableCell>
              <TableCell className="max-w-[160px] whitespace-normal text-muted-foreground">
                {project.estLetDateRange}
              </TableCell>
              <TableCell className="text-right font-semibold">
                {formatCurrency(project.estConstructionCost)}
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

async function zoomToLayer(
  layer: ArcGisApi["GeoJSONLayer"],
  view: ReturnType<ArcGisApi["MapView"]>,
  where: string,
) {
  const result = await layer.queryExtent({ where });
  if (result.extent) {
    (view as any).goTo(result.extent, { duration: 450 }).catch(() => undefined);
  }
}

// Every listed project has geometry in the standalone file as of the last
// scripts/build-project-geometry.js run, but this can still legitimately
// return false if the document is updated without re-running that script.
async function zoomToProject(
  csj: string,
  layer: ArcGisApi["GeoJSONLayer"] | null,
  view: ReturnType<ArcGisApi["MapView"]> | null,
) {
  if (!layer || !view) {
    return false;
  }

  const where = `csj = '${csj.replaceAll("'", "''")}'`;
  const featureResult = await layer.queryFeatures({ where, outFields: ["*"], returnGeometry: true });
  const feature = featureResult.features?.[0];
  if (!feature) {
    return false;
  }

  const extentResult = await layer.queryExtent({ where });
  if (extentResult.extent) {
    await (view as any).goTo(extentResult.extent, { duration: 500 }).catch(() => undefined);
  }

  if (typeof (view as any).popup?.open === "function") {
    (view as any).popup.open({
      features: [feature],
      location: (feature as any).geometry?.extent?.center ?? (feature as any).geometry,
    });
  }

  return true;
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

function groupAmount(projects: ListedProject[], key: "county" | "estLetDateRange") {
  const totals = projects.reduce<Record<string, number>>((acc, project) => {
    const value = project[key] || "Unspecified";
    acc[value] = (acc[value] ?? 0) + project.estConstructionCost;
    return acc;
  }, {});

  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}
