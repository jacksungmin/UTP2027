// Extracts standalone GeoJSON geometry for the projects in
// lib/utp-2027-listed-projects.json, so the map no longer needs to query
// live ArcGIS services at runtime.
//
// Geometry source priority per project:
//   1. TxDOT's live GIS layer (CONTROL_SECT_JOB, undashed CSJ)
//   2. H-GAC's RTP 2045 layer, as a fallback for projects TxDOT tracks under
//      different segment-level CSJs (e.g. NHHIP / 0500-08-001), using the
//      same dashed CSJ format as the UTP document
//
// Re-run this whenever lib/utp-2027-listed-projects.json changes:
//   node scripts/build-project-geometry.js
//
// Each output feature carries a minimal set of properties (csj, highway,
// county, estLetDateRange) - just enough to filter and color the map layer.
// Full project detail (funding categories, UTP action, cost, etc.) still
// comes from lib/utp-2027-listed-projects.json, looked up by csj at
// popup-render time, so there's one authoritative source for that data.

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const TXDOT_QUERY_URL =
  "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Projects_Info/FeatureServer/0/query";
const RTP2045_QUERY_URL =
  "https://gis.h-gac.com/arcgis/rest/services/Trans_RTP_Outreach/rtp_2045/MapServer/1/query";
const COUNTY_QUERY_URL =
  "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Counties_Generalized_Boundaries/FeatureServer/0/query";

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

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectsPath = path.join(rootDir, "lib/utp-2027-listed-projects.json");
const projectGeometryPath = path.join(rootDir, "public/utp-2027-project-geometry.geojson");
const countyBoundaryPath = path.join(rootDir, "public/hgac-county-boundaries.geojson");

function toGisCsj(csj) {
  return csj.replaceAll("-", "");
}

function toEsriPolylineGeoJson(esriGeometry) {
  return { type: "MultiLineString", coordinates: esriGeometry.paths };
}

async function fetchJson(url, params) {
  const query = new URLSearchParams({ f: "json", ...params });
  const response = await fetch(`${url}?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${url}`);
  }
  const data = await response.json();
  if (data.error) {
    throw new Error(`ArcGIS error from ${url}: ${JSON.stringify(data.error)}`);
  }
  return data;
}

async function fetchTxdotGeometry(projects) {
  const csjs = projects.map((project) => toGisCsj(project.csj));
  const where = `PRJ_UTP = 1 AND CONTROL_SECT_JOB IN (${csjs.map((csj) => `'${csj}'`).join(",")})`;
  const response = await fetch(
    `${TXDOT_QUERY_URL}?${new URLSearchParams({
      where,
      outFields: "CONTROL_SECT_JOB",
      f: "geojson",
    }).toString()}`,
  );
  const data = await response.json();
  const byCsj = new Map();
  for (const feature of data.features ?? []) {
    byCsj.set(feature.properties.CONTROL_SECT_JOB, feature.geometry);
  }
  return byCsj;
}

async function fetchRtpGeometry(projects) {
  if (!projects.length) {
    return new Map();
  }
  const csjs = projects.map((project) => project.csj);
  const where = `rtp.CSJNumber IN (${csjs.map((csj) => `'${csj}'`).join(",")})`;
  const data = await fetchJson(RTP2045_QUERY_URL, {
    where,
    outFields: "rtp.CSJNumber",
    outSR: "4326",
  });
  const byCsj = new Map();
  for (const feature of data.features ?? []) {
    byCsj.set(feature.attributes["rtp.CSJNumber"], toEsriPolylineGeoJson(feature.geometry));
  }
  return byCsj;
}

async function buildProjectGeometry() {
  const projects = JSON.parse(readFileSync(projectsPath, "utf8"));

  const txdotGeometry = await fetchTxdotGeometry(projects);
  const missing = projects.filter((project) => !txdotGeometry.has(toGisCsj(project.csj)));
  const rtpGeometry = await fetchRtpGeometry(missing);

  const features = [];
  const stillMissing = [];
  for (const project of projects) {
    const geometry = txdotGeometry.get(toGisCsj(project.csj)) ?? rtpGeometry.get(project.csj);
    if (!geometry) {
      stillMissing.push(project.csj);
      continue;
    }
    features.push({
      type: "Feature",
      geometry,
      properties: {
        csj: project.csj,
        highway: project.highway,
        county: project.county,
        estLetDateRange: project.estLetDateRange,
      },
    });
  }

  writeFileSync(
    projectGeometryPath,
    `${JSON.stringify({ type: "FeatureCollection", features }, null, 2)}\n`,
  );

  console.log(`Wrote ${features.length}/${projects.length} project geometries to ${projectGeometryPath}`);
  if (stillMissing.length) {
    console.warn(`No geometry found for: ${stillMissing.join(", ")}`);
  }
}

async function buildCountyBoundaries() {
  const where = `STATE_NAME = 'Texas' AND NAME IN (${hgacCounties
    .map((county) => `'${county} County'`)
    .join(",")})`;
  const response = await fetch(
    `${COUNTY_QUERY_URL}?${new URLSearchParams({
      where,
      outFields: "NAME",
      f: "geojson",
    }).toString()}`,
  );
  const data = await response.json();
  const features = (data.features ?? []).map((feature) => ({
    type: "Feature",
    geometry: feature.geometry,
    properties: { name: feature.properties.NAME.replace(" County", "") },
  }));

  writeFileSync(
    countyBoundaryPath,
    `${JSON.stringify({ type: "FeatureCollection", features }, null, 2)}\n`,
  );
  console.log(`Wrote ${features.length}/${hgacCounties.length} county boundaries to ${countyBoundaryPath}`);
}

async function main() {
  await buildProjectGeometry();
  await buildCountyBoundaries();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
