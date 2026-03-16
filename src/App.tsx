import { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap, Marker, Popup, Polyline, Polygon, useMapEvents } from 'react-leaflet';
import { LocateFixed, Search, Download, CloudOff, Map as MapIcon, Layers, List, BarChart2, FileDown, X, MessageSquare, PenTool, Moon, Sun, Filter, Trash2, Upload, MapPin, Route, Zap } from 'lucide-react';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import localforage from 'localforage';
import axios from 'axios';
import osmtogeojson from 'osmtogeojson';
import { HeatmapLayer } from 'react-leaflet-heatmap-layer-v3';
import { format } from 'date-fns';
import Papa from 'papaparse';

// Fix for default Leaflet marker icons in React
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

type StatusColor = 'unvisited' | 'rot' | 'grün' | 'gelb';
interface BuildingStatus {
  color: StatusColor;
  note: string;
  updatedAt: number;
}
type Tab = 'map' | 'heatmap' | 'list' | 'stats';

const PRIMARY_RED = '#E52B38';
const SUCCESS_GREEN = '#00C851';
const WARNING_YELLOW = '#ffbb33';

function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getCentroid(feature: any): [number, number] {
  let latSum = 0, lngSum = 0, count = 0;
  const coords = feature.geometry.type === 'Polygon' 
    ? feature.geometry.coordinates[0] 
    : feature.geometry.type === 'MultiPolygon'
      ? feature.geometry.coordinates[0][0]
      : [];
  
  if (coords && coords.length > 0) {
    coords.forEach((coord: number[]) => {
      latSum += coord[1];
      lngSum += coord[0];
      count++;
    });
    return [latSum / count, lngSum / count];
  }
  return [0, 0];
}


function MapInteraction({ isDrawing, onAddPoint }: { isDrawing: boolean, onAddPoint: (pt: [number, number]) => void }) {
  useMapEvents({
    click(e) {
      if (isDrawing) {
        onAddPoint([e.latlng.lat, e.latlng.lng]);
      }
    }
  });
  return null;
}

function LocationMarker({ triggerLocate, onLocationFound }: { triggerLocate: number, onLocationFound: (pos: [number, number]) => void }) {
  const map = useMap();
  const hasCentered = useRef(false);

  useEffect(() => {
    map.on('locationfound', (e) => {
      const pos: [number, number] = [e.latlng.lat, e.latlng.lng];
      onLocationFound(pos);
      
      // Only auto-fly the first time we find the location
      if (!hasCentered.current) {
        map.flyTo(e.latlng, 17);
        hasCentered.current = true;
      }
    });

    map.on('locationerror', (e) => {
      console.error("GPS Error:", e.message);
    });

    map.locate({ watch: true, setView: false, enableHighAccuracy: true });
  }, [map]);

  useEffect(() => {
    if (triggerLocate > 0) {
      map.locate({ setView: true, maxZoom: 18, enableHighAccuracy: true });
    }
  }, [map, triggerLocate]);

  return null;
}




function App() {
  const [statuses, setStatuses] = useState<Record<string, BuildingStatus>>({});
  const [locateMe, setLocateMe] = useState(0);
  const [buildings, setBuildings] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('map');
  const [selectedFeature, setSelectedFeature] = useState<any>(null);
  const mapRef = useRef<L.Map>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [drawnPolygon, setDrawnPolygon] = useState<[number, number][]>([]);
  const isDrawingRef = useRef(false);

  // New Ultimate Features State
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Record<StatusColor, boolean>>({
    unvisited: true, rot: true, grün: true, gelb: true
  });
  const [optimizedRoute, setOptimizedRoute] = useState<[number, number][]>([]);
  const [roadGeometry, setRoadGeometry] = useState<[number, number][]>([]);
  const [routeHouses, setRouteHouses] = useState<any[]>([]);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [showRouteMenu, setShowRouteMenu] = useState(false);
  const [dailyGoal, setDailyGoal] = useState(5);
  const [cheatMode, setCheatMode] = useState(false);






  useEffect(() => {
    isDrawingRef.current = isDrawing;
  }, [isDrawing]);

  // Cheat Mode Keyboard Listener
  useEffect(() => {
    if (!cheatMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const step = 0.0001; // roughly 10-15 meters
      setUserLocation(prev => {
        let current = prev;
        if (!current) current = [48.2082, 16.3738]; // Default start (Vienna) if no location yet
        
        let [lat, lng] = current;
        if (e.key === 'ArrowUp') lat += step;
        if (e.key === 'ArrowDown') lat -= step;
        if (e.key === 'ArrowLeft') lng -= step;
        if (e.key === 'ArrowRight') lng += step;
        
        const next: [number, number] = [lat, lng];
        if (mapRef.current) {
          mapRef.current.panTo(next);
        }
        return next;
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cheatMode]);

  // Handle Dark mode class on body
  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark');
      document.body.style.backgroundColor = '#121212';
      document.body.style.color = '#fff';
    } else {
      document.body.classList.remove('dark');
      document.body.style.backgroundColor = '#f8f9fa';
      document.body.style.color = '#000';
    }
  }, [isDarkMode]);

  const getThemeBackground = () => isDarkMode ? '#121212' : '#f8f9fa';
  const getCardBackground = () => isDarkMode ? '#222' : 'white';


  // Initialize data from localforage
  useEffect(() => {
    async function loadData() {
      const savedBuildings = await localforage.getItem('offlineBuildings');
      if (savedBuildings) {
        setBuildings(savedBuildings);
      }
    }
    loadData();
  }, []);

  // Load saved statuses from local storage
  useEffect(() => {
    const saved = localStorage.getItem('buildingStatuses');
    if (saved) {
      setStatuses(JSON.parse(saved));
    }
  }, []);

  // Save statuses when updated
  useEffect(() => {
    localStorage.setItem('buildingStatuses', JSON.stringify(statuses));
  }, [statuses]);

  const getColor = (color: StatusColor | undefined) => {
    if (color === 'rot') return PRIMARY_RED;
    if (color === 'grün') return SUCCESS_GREEN;
    if (color === 'gelb') return WARNING_YELLOW;
    return 'transparent'; // No background for unvisited
  };


  const handlePolygonClick = (feature: any) => {
    setSelectedFeature(feature);
  };

  const updateStatus = (featureId: string, color: StatusColor, note: string = '') => {
    // Haptic feedback
    if ('vibrate' in navigator) {
      navigator.vibrate(50);
    }

    setStatuses(prev => ({
      ...prev,
      [featureId]: {
        color,
        note,
        updatedAt: Date.now()
      }
    }));
    setSelectedFeature(null);
  };


  const nextStop = useMemo(() => {
    if (!routeHouses || routeHouses.length === 0) return null;
    // Find first house in the route that is totally unvisited
    const firstUnvisited = routeHouses.find(f => {
      const s = statuses[f.id]?.color || 'unvisited';
      return s === 'unvisited';
    });
    
    // If no unvisited left, fall back to first 'gelb' (to keep route visible)
    if (!firstUnvisited) {
      return routeHouses.find(f => statuses[f.id]?.color === 'gelb') || null;
    }
    
    return firstUnvisited;
  }, [routeHouses, statuses]);



  const nextStopIndex = useMemo(() => {
    if (!nextStop || !routeHouses) return -1;
    return routeHouses.findIndex(f => f.id === nextStop.id);
  }, [nextStop, routeHouses]);

  const streetProgress = useMemo(() => {
    if (!nextStop || !buildings) return null;
    const currentStreet = nextStop.properties?.['addr:street'];
    if (!currentStreet) return null;

    const streetHouses = buildings.features.filter((f: any) => f.properties?.['addr:street'] === currentStreet);
    const finishedHouses = streetHouses.filter((f: any) => {
      const s = statuses[f.id]?.color || 'unvisited';
      return s !== 'unvisited' && s !== 'gelb';
    });

    return {
      name: currentStreet,
      done: finishedHouses.length,
      total: streetHouses.length
    };
  }, [nextStop, buildings, statuses]);

  const next5Ids = useMemo(() => {
    if (nextStopIndex === -1 || !routeHouses) return new Set<string>();
    return new Set(routeHouses.slice(nextStopIndex, nextStopIndex + 5).map(f => f.id));
  }, [nextStopIndex, routeHouses]);




  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery || !mapRef.current) return;
    try {
      setLoading(true);
      const res = await axios.get(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`);
      if (res.data && res.data.length > 0) {
        const { lat, lon } = res.data[0];
        mapRef.current.flyTo([parseFloat(lat), parseFloat(lon)], 16);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const downloadArea = async () => {
    let query = '';

    if (drawnPolygon.length >= 3) {
      // User defined polygon
      const polyStr = drawnPolygon.map(p => `${p[0]} ${p[1]}`).join(' ');
      query = `
        [out:json][timeout:60];
        (
          way["building"]["addr:housenumber"](poly:"${polyStr}");
          relation["building"]["addr:housenumber"](poly:"${polyStr}");
        );
        out body;
        >;
        out skel qt;
      `;
    } else {
      // Screen bounds fallback
      if (!mapRef.current) return;
      const bounds = mapRef.current.getBounds();
      const s = bounds.getSouth();
      const n = bounds.getNorth();
      const w = bounds.getWest();
      const e = bounds.getEast();

      query = `
        [out:json][timeout:60];
        (
          way["building"]["addr:housenumber"](${s},${w},${n},${e});
          relation["building"]["addr:housenumber"](${s},${w},${n},${e});
        );
        out body;
        >;
        out skel qt;
      `;
    }

    try {
      setLoading(true);
      const res = await axios.post('https://overpass-api.de/api/interpreter', query, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const geojson = osmtogeojson(res.data) as any;

      let mergedFeatures = buildings ? [...buildings.features] : [];
      let added = 0;
      const existingIds = new Set(mergedFeatures.map((f: any) => f.id));

      geojson.features.forEach((f: any) => {
        if (!existingIds.has(f.id)) {
          mergedFeatures.push(f);
          added++;
        }
      });

      const newBuildingsObj = { type: 'FeatureCollection', features: mergedFeatures };
      setBuildings(newBuildingsObj);
      await localforage.setItem('offlineBuildings', newBuildingsObj);

      setIsDrawing(false);
      setDrawnPolygon([]);
      alert(`Erfolgreich ${added} neue Gebäude heruntergeladen!`);
    } catch (err: any) {
      console.error(err);
      if (err.response && (err.response.status === 504 || err.response.status === 502)) {
        alert('Zeitüberschreitung (Gateway Timeout) vom Server! Das Servernetzwerk ist überlastet oder das ausgewählte Gebiet ist zu groß. Bitte versuche ein kleineres Gebiet.');
      } else {
        alert('Fehler beim Herunterladen der Häuser. Bitte versuche es noch einmal.');
      }
    } finally {
      setLoading(false);
    }
  };

  const exportData = () => {
    if (!buildings) return;
    const exportable = buildings.features
      .filter((f: any) => statuses[f.id] && statuses[f.id].color !== 'unvisited')
      .map((f: any) => {
        const stat = statuses[f.id];
        return {
          OSM_ID: f.id,
          Strasse: f.properties?.['addr:street'] || '',
          Hausnummer: f.properties?.['addr:housenumber'] || '',
          Status: stat.color === 'grün' ? 'Vertrag erfolgreich' : stat.color === 'gelb' ? 'Nicht angetroffen' : 'Abgelehnt',
          Notiz: stat.note,
          Zuletzt_Bearbeitet: format(stat.updatedAt, 'dd.MM.yyyy HH:mm:ss')
        };
      });

    const csv = Papa.unparse(exportable);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Fundraising_Export_${format(Date.now(), 'yyyyMMdd_HHmm')}.csv`;
    link.click();
  };

  const exportBackupJSON = () => {
    const backup = { statuses, buildings };
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Fundraising_Backup_${format(Date.now(), 'yyyyMMdd_HHmm')}.json`;
    link.click();
  };

  const importBackupJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (data.statuses && data.buildings) {
          setStatuses(data.statuses);
          setBuildings(data.buildings);
          await localforage.setItem('offlineBuildings', data.buildings);
          alert('Backup erfolgreich importiert!');
        } else {
          alert('Ungültige Backup-Datei.');
        }
      } catch (err) {
        alert('Fehler beim Lesen der Datei.');
      }
    };
    reader.readAsText(file);
  };

  const clearAllData = async () => {
    if (window.confirm('WARNUNG: Willst du WIRKLICH alle heruntergeladenen Häuser und alle Farben löschen? Dies kann nicht rückgängig gemacht werden!')) {
      setStatuses({});
      setBuildings(null);
      await localforage.removeItem('offlineBuildings');
      localStorage.removeItem('buildingStatuses');
      alert('Alle Daten wurden gelöscht.');
    }
  };

  const clearStatusesOnly = () => {
    if (window.confirm('Willst du nur die Farben (Besuche) löschen, aber die Karte behalten?')) {
      setStatuses({});
      localStorage.removeItem('buildingStatuses');
    }
  };

  const calculateRoute = async (mode: 'all' | 'unvisited' | 'yellow' = 'all') => {
    if (!buildings || buildings.features.length === 0) {
      alert("Lade erst eine Karte herunter!");
      return;
    }

    setLoading(true);
    setShowRouteMenu(false);
    try {
      // Filter based on mode
      const targetHouses = buildings.features
        .filter((f: any) => {
          const status = statuses[f.id]?.color || 'unvisited';
          if (mode === 'unvisited') return status === 'unvisited';
          if (mode === 'yellow') return status === 'gelb';
          // 'all' includes unvisited and yellow
          return status === 'unvisited' || status === 'gelb';
        })

        .map((f: any) => ({
          id: f.id,
          feature: f,
          centroid: getCentroid(f)
        }));

      if (targetHouses.length === 0) {
        alert("Keine passenden Häuser für diese Route gefunden!");
        setLoading(false);
        return;
      }

      // Determine starting point
      let startPoint: [number, number] = userLocation || (mapRef.current ? [mapRef.current.getCenter().lat, mapRef.current.getCenter().lng] : targetHouses[0].centroid);

      // Sequencing
      let unvisited = [...targetHouses];
      let currentPos = startPoint;
      let orderedCentroids: [number, number][] = [startPoint];
      let orderedHouses: any[] = [];

      while (unvisited.length > 0) {
        let nearestIdx = -1;
        let minDist = Infinity;

        for (let i = 0; i < unvisited.length; i++) {
          const d = getDistance(currentPos[0], currentPos[1], unvisited[i].centroid[0], unvisited[i].centroid[1]);
          if (d < minDist) {
            minDist = d;
            nearestIdx = i;
          }
        }

        const next = unvisited.splice(nearestIdx, 1)[0];
        orderedCentroids.push(next.centroid);
        orderedHouses.push(next.feature);
        currentPos = next.centroid;
      }

      // Road Geometry
      const coordinates = orderedCentroids.map(c => `${c[1]},${c[0]}`).join(';');
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`;
      
      const res = await axios.get(osrmUrl);
      
      if (res.data.routes && res.data.routes[0]) {
        const roadPoints = res.data.routes[0].geometry.coordinates.map((c: any) => [c[1], c[0]]);
        setRoadGeometry(roadPoints);
        setOptimizedRoute(orderedCentroids);
        setRouteHouses(orderedHouses);
        setActiveTab('map');
        
        if (mapRef.current) {
          const bounds = L.latLngBounds(roadPoints);
          mapRef.current.fitBounds(bounds, { padding: [50, 50] });
        }
      } else {
        setRoadGeometry(orderedCentroids);
        setOptimizedRoute(orderedCentroids);
        setRouteHouses(orderedHouses);
        alert("Straßen-Routing fehlgeschlagen. Zeige Luftlinie.");
      }
    } catch (err) {
      console.error("Routing error:", err);
      alert("Fehler bei der Routenberechnung.");
    } finally {
      setLoading(false);
    }
  };




  // Prepare heatmap data
  const getColoredHeatmapData = (targetColor: StatusColor) => {
    if (!buildings) return [];
    return buildings.features
      .filter((f: any) => statuses[f.id]?.color === targetColor)
      .map((f: any) => {
        let latSum = 0, lngSum = 0, count = 0;
        const coords = f.geometry.coordinates[0];
        if (coords && coords.length > 0) {
          coords.forEach((coord: number[]) => {
            latSum += coord[1];
            lngSum += coord[0];
            count++;
          });
          return [latSum / count, lngSum / count, 1];
        }
        return null;
      })
      .filter(Boolean);
  };

  const heatmapDataGreen = useMemo(() => getColoredHeatmapData('grün'), [buildings, statuses]);
  const heatmapDataYellow = useMemo(() => getColoredHeatmapData('gelb'), [buildings, statuses]);
  const heatmapDataRed = useMemo(() => getColoredHeatmapData('rot'), [buildings, statuses]);

  // Prepare stats
  const stats = useMemo(() => {
    const counts = { rot: 0, grün: 0, gelb: 0, unvisited: 0, total: 0 };
    if (!buildings) return counts;
    buildings.features.forEach((f: any) => {
      const color = statuses[f.id]?.color || 'unvisited';
      counts[color]++;
      counts.total++;
    });
    return counts;
  }, [buildings, statuses]);

  // List View Rendering
  const renderList = () => {
    if (!buildings) return <div style={{ padding: 20 }}>Lade erst eine Karte herunter.</div>;
    
    // If we have an optimized route, we want to show that order
    if (routeHouses.length > 0) {
      return (
        <div style={{ padding: 20, paddingBottom: 80, height: '100%', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
             <h2 style={{ margin: 0 }}>Optimierte Route ({routeHouses.length})</h2>
             <button 
               onClick={() => { setOptimizedRoute([]); setRouteHouses([]); setRoadGeometry([]); }}
               style={{ background: 'none', border: 'none', color: PRIMARY_RED, fontWeight: 'bold' }}
             >
               Route aufheben
             </button>
          </div>

          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {routeHouses.map((f: any, idx) => {
              const stat = statuses[f.id] || { color: 'unvisited', note: '' };
              return (
                <li key={f.id} style={{ 
                  padding: '16px', 
                  borderBottom: `1px solid ${isDarkMode ? '#333' : '#f5f5f5'}`, 
                  background: isDarkMode ? '#222' : 'white', 
                  borderRadius: 12, 
                  marginBottom: 12,
                  borderLeft: `6px solid ${getColor(stat.color)}`,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <div style={{ 
                        background: '#2563eb', 
                        color: 'white', 
                        width: 28, 
                        height: 28, 
                        borderRadius: '50%', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        fontWeight: 'bold',
                        flexShrink: 0
                      }}>
                        {idx + 1}
                      </div>
                      <div>
                        <strong style={{ fontSize: 16, color: isDarkMode ? '#fff' : '#000' }}>
                          {f.properties?.['addr:street'] || 'Straße unbekannt'} {f.properties?.['addr:housenumber'] || '?'}
                        </strong>
                        <div style={{ fontSize: 13, color: '#999', marginTop: 2 }}>
                          {stat.color === 'unvisited' ? 'Noch nicht besucht' : 'Zuletzt besucht: ' + format(stat.updatedAt, 'HH:mm')}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => setSelectedFeature(f)}
                        style={{ padding: '8px 12px', background: isDarkMode ? '#333' : '#f0f0f0', color: isDarkMode ? '#fff' : '#333', borderRadius: 8, border: 'none', fontWeight: 'bold', fontSize: 13 }}
                      >
                        Status
                      </button>
                      <a
                        href={`https://maps.apple.com/?daddr=${getCentroid(f)[0]},${getCentroid(f)[1]}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ padding: '8px 12px', background: SUCCESS_GREEN, color: 'white', borderRadius: 8, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 'bold' }}
                      >
                        <MapPin size={16} /> Route
                      </a>
                    </div>
                  </div>
                  {stat.note && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 12, color: isDarkMode ? '#bbb' : '#666', fontSize: 14, background: isDarkMode ? '#2a2a2a' : '#f9f9f9', padding: 10, borderRadius: 8 }}>
                      <MessageSquare size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                      <span>{stat.note}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      );
    }

    const visited = buildings.features.filter((f: any) => statuses[f.id] && statuses[f.id].color !== 'unvisited');

    // Sort by most recently updated
    visited.sort((a: any, b: any) => (statuses[b.id]?.updatedAt || 0) - (statuses[a.id]?.updatedAt || 0));

    return (
      <div style={{ padding: 20, paddingBottom: 80, height: '100%', overflowY: 'auto' }}>
        <h2>Besuchte Häuser ({visited.length})</h2>
        {[
          { color: 'grün', label: 'Vertrag erfolgreich' },
          { color: 'gelb', label: 'Nicht angetroffen' },
          { color: 'rot', label: 'Abgelehnt' }
        ].map(({ color, label }) => {
          const group = visited.filter((f: any) => statuses[f.id]?.color === color);
          if (group.length === 0) return null;
          return (
            <div key={color} style={{ marginBottom: 24, background: 'white', borderRadius: 12, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <h3 style={{ color: getColor(color as StatusColor), marginTop: 0, borderBottom: '1px solid #eee', paddingBottom: 8 }}>{label} ({group.length})</h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {group.map((f: any) => {
                  const stat = statuses[f.id];
                  return (
                    <li key={f.id} style={{ padding: '16px', borderBottom: `1px solid ${isDarkMode ? '#333' : '#f5f5f5'}`, background: isDarkMode ? '#222' : 'white', borderRadius: 12, marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <strong style={{ fontSize: 16, color: isDarkMode ? '#fff' : '#000' }}>{f.properties?.['addr:street'] || 'Straße unbekannt'} {f.properties?.['addr:housenumber'] || '?'}</strong>
                          <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>{format(stat.updatedAt, 'HH:mm')}</div>
                        </div>
                        <a
                          href={`https://maps.apple.com/?daddr=${getCentroid(f)[0]},${getCentroid(f)[1]}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ padding: '8px 12px', background: '#f0f0f0', color: '#333', borderRadius: 8, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 'bold' }}
                        >
                          <MapPin size={16} /> Route
                        </a>
                      </div>
                      {stat.note && (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 12, color: isDarkMode ? '#bbb' : '#666', fontSize: 14, background: isDarkMode ? '#2a2a2a' : '#f9f9f9', padding: 10, borderRadius: 8 }}>
                          <MessageSquare size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                          <span>{stat.note}</span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

      </div>
    );
  };

  // Stats View Rendering

  const renderStats = () => {
    const visitedTotal = stats.rot + stats.grün + stats.gelb;
    const getPercent = (count: number) => visitedTotal === 0 ? 0 : (count / visitedTotal) * 100;
    const goalPercent = Math.min((stats.grün / dailyGoal) * 100, 100);

    return (
      <div style={{ padding: 20, height: '100%', overflowY: 'auto', paddingBottom: 80 }}>
        <h2 style={{ color: isDarkMode ? '#fff' : '#333' }}>Statistik</h2>

        {/* Daily Goal Card */}
        <div style={{ background: getCardBackground(), borderRadius: 20, padding: 20, marginBottom: 24, boxShadow: '0 4px 15px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ position: 'relative', width: 80, height: 80, flexShrink: 0 }}>
            <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
              <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#eee" strokeWidth="3" />
              <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke={SUCCESS_GREEN} strokeWidth="3" strokeDasharray={`${goalPercent}, 100`} strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.5s ease' }} />
            </svg>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 'bold', color: SUCCESS_GREEN }}>{stats.grün}</div>
              <div style={{ fontSize: 10, color: '#999' }}>/ {dailyGoal}</div>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 'bold', color: isDarkMode ? '#fff' : '#333' }}>Tagesziel</div>
            <div style={{ fontSize: 14, color: '#888' }}>{goalPercent === 100 ? '🎉 Ziel erreicht!' : `${dailyGoal - stats.grün} weitere Verträge nötig`}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
               {[3, 5, 10].map(g => (
                 <button key={g} onClick={() => setDailyGoal(g)} style={{ padding: '4px 8px', borderRadius: 4, border: `1px solid ${dailyGoal === g ? SUCCESS_GREEN : '#ddd'}`, background: dailyGoal === g ? SUCCESS_GREEN : 'none', color: dailyGoal === g ? 'white' : '#888', fontSize: 12 }}>{g}</button>
               ))}
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{ width: '100%', height: 24, display: 'flex', borderRadius: 12, overflow: 'hidden', marginBottom: 24, background: '#f0f0f0' }}>
          {visitedTotal > 0 && (
            <>
              <div style={{ width: `${getPercent(stats.grün)}%`, background: SUCCESS_GREEN, transition: 'width 0.3s' }} />
              <div style={{ width: `${getPercent(stats.gelb)}%`, background: WARNING_YELLOW, transition: 'width 0.3s' }} />
              <div style={{ width: `${getPercent(stats.rot)}%`, background: PRIMARY_RED, transition: 'width 0.3s' }} />
            </>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ padding: 16, background: getCardBackground(), color: isDarkMode ? '#fff' : '#000', borderRadius: 12, textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <h3 style={{ margin: '0 0 5px', fontSize: 13, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>Alle Häuser</h3>
            <p style={{ fontSize: 24, margin: 0, fontWeight: 'bold' }}>{stats.total}</p>
          </div>
          <div style={{ padding: 16, background: getCardBackground(), color: isDarkMode ? '#fff' : '#000', borderRadius: 12, textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <h3 style={{ margin: '0 0 5px', fontSize: 13, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>Besucht</h3>
            <p style={{ fontSize: 24, margin: 0, fontWeight: 'bold' }}>{visitedTotal}</p>
          </div>
          <div style={{ padding: 16, background: SUCCESS_GREEN, color: 'white', borderRadius: 12, textAlign: 'center', gridColumn: '1 / -1', boxShadow: '0 4px 12px rgba(0,200,81,0.2)' }}>
            <h3 style={{ margin: '0 0 5px', fontSize: 16 }}>Vertrag erfolgreich</h3><p style={{ fontSize: 24, margin: 0, fontWeight: 'bold' }}>{stats.grün}</p>
          </div>
          <div style={{ padding: 16, background: WARNING_YELLOW, color: 'white', borderRadius: 12, textAlign: 'center', gridColumn: '1 / -1', boxShadow: '0 4px 12px rgba(255,187,51,0.2)' }}>
            <h3 style={{ margin: '0 0 5px', fontSize: 16 }}>Nicht angetroffen</h3><p style={{ fontSize: 24, margin: 0, fontWeight: 'bold' }}>{stats.gelb}</p>
          </div>
          <div style={{ padding: 16, background: PRIMARY_RED, color: 'white', borderRadius: 12, textAlign: 'center', gridColumn: '1 / -1', boxShadow: '0 4px 12px rgba(229,43,56,0.2)' }}>
            <h3 style={{ margin: '0 0 5px', fontSize: 16 }}>Abgelehnt</h3><p style={{ fontSize: 24, margin: 0, fontWeight: 'bold' }}>{stats.rot}</p>
          </div>
        </div>

        {/* DEV PANEL */}
        <div style={{ marginTop: 24, background: '#1e293b', borderRadius: 12, padding: 16, color: '#94a3b8', border: '1px solid #334155' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: '#f8fafc' }}>
            <Zap size={18} color="#f59e0b" />
            <h3 style={{ margin: 0, fontSize: 14, textTransform: 'uppercase', letterSpacing: 1 }}>Developer Panel</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button 
              onClick={() => {
                const newStatuses = { ...statuses };
                buildings?.features.slice(0, 10).forEach((f: any) => {
                  newStatuses[f.id] = { color: Math.random() > 0.5 ? 'grün' : 'rot', updatedAt: Date.now(), note: 'Simuliert' };
                });
                setStatuses(newStatuses);
              }}
              style={{ padding: '8px', background: '#334155', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 'bold' }}
            >
              Simuliere 10 Besuche
            </button>
            <button 
              onClick={() => {
                const newStatuses = { ...statuses };
                buildings?.features.forEach((f: any) => {
                  if (Math.random() > 0.8) newStatuses[f.id] = { color: 'gelb', updatedAt: Date.now(), note: 'Nochmal versuchen' };
                });
                setStatuses(newStatuses);
              }}
              style={{ padding: '8px', background: '#334155', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 'bold' }}
            >
              Simuliere "Gelbe" Häuser
            </button>
            <button 
              onClick={() => {
                setCheatMode(!cheatMode);
                if (!cheatMode && !userLocation && mapRef.current) {
                  const center = mapRef.current.getCenter();
                  setUserLocation([center.lat, center.lng]);
                }
              }}
              style={{ padding: '8px', background: cheatMode ? SUCCESS_GREEN : '#334155', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 'bold', gridColumn: '1 / -1', marginTop: 8 }}
            >
              🚀 Cheat Mode (Pfeiltasten): {cheatMode ? 'AN' : 'AUS'}
            </button>
          </div>
        </div>

        <button
          onClick={exportData}
          style={{ width: '100%', marginTop: 24, padding: 16, background: isDarkMode ? '#222' : 'white', border: `2px solid ${PRIMARY_RED}`, color: PRIMARY_RED, borderRadius: 12, fontWeight: 'bold', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <FileDown size={20} />
          Daten als CSV exportieren
        </button>

        <div style={{ marginTop: 24, background: getCardBackground(), borderRadius: 12, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16, color: isDarkMode ? '#fff' : '#333' }}>Datenverwaltung (Backup)</h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
            <button onClick={exportBackupJSON} style={{ padding: 12, background: PRIMARY_RED, color: 'white', border: 'none', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 'bold' }}>
              <Download size={18} /> Backup speichern (.json)
            </button>
            <label style={{ padding: 12, background: isDarkMode ? '#333' : '#f0f0f0', color: isDarkMode ? '#fff' : '#333', border: 'none', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 'bold', cursor: 'pointer', textAlign: 'center' }}>
              <Upload size={18} /> Backup importieren
              <input type="file" accept=".json" onChange={importBackupJSON} style={{ display: 'none' }} />
            </label>
            <div style={{ height: 1, background: isDarkMode ? '#444' : '#eee', margin: '8px 0' }} />
            <button onClick={clearStatusesOnly} style={{ padding: 12, background: 'none', color: WARNING_YELLOW, border: `2px solid ${WARNING_YELLOW}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 'bold' }}>
              <Trash2 size={18} /> Nur Besuche löschen
            </button>
            <button onClick={clearAllData} style={{ padding: 12, background: 'none', color: PRIMARY_RED, border: `2px solid ${PRIMARY_RED}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 'bold' }}>
              <Trash2 size={18} /> Gesamte Karte löschen
            </button>
          </div>
        </div>
      </div>
    );
  };



  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: getThemeBackground(), fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}>

      {/* Rote Nasen Header */}
      <div style={{ background: PRIMARY_RED, color: 'white', padding: 'env(safe-area-inset-top) 16px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 2px 10px rgba(229,43,56,0.3)', zIndex: 1001 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: 0.5, paddingTop: 'max(12px, env(safe-area-inset-top))' }}>Rote Nasen Fundraising</h1>
        <button onClick={() => setIsDarkMode(!isDarkMode)} style={{ background: 'none', border: 'none', color: 'white', padding: 'max(12px, env(safe-area-inset-top)) 0 0 0' }}>
          {isDarkMode ? <Sun size={24} /> : <Moon size={24} />}
        </button>
      </div>

      {/* Dynamic Content Area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {(activeTab === 'map' || activeTab === 'heatmap') && (
          <>
            {/* Top Search Bar */}
            <div style={{ position: 'absolute', top: 16, left: 16, right: 16, zIndex: 1000, display: 'flex', gap: '8px' }}>
              <form onSubmit={handleSearch} style={{ display: 'flex', flex: 1, background: 'white', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
                <input
                  type="text"
                  placeholder="Ort suchen..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={{ flex: 1, border: 'none', padding: '14px 16px', fontSize: '16px', outline: 'none' }}
                />
                <button type="submit" style={{ border: 'none', background: 'white', padding: '0 16px', color: PRIMARY_RED }} disabled={loading}>
                  <Search size={22} />
                </button>
              </form>
            </div>

            <button
              onClick={() => setLocateMe(prev => prev + 1)}
              style={{ position: 'absolute', bottom: 32, right: 16, zIndex: 1000, padding: '14px', background: 'white', borderRadius: '50%', border: 'none', boxShadow: '0 4px 15px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <LocateFixed size={24} color={PRIMARY_RED} />
            </button>

            <button
              onClick={() => {
                if (isDrawing) {
                  setIsDrawing(false);
                  setDrawnPolygon([]);
                } else {
                  setIsDrawing(true);
                  setDrawnPolygon([]);
                  setSelectedFeature(null);
                }
              }}
              style={{ position: 'absolute', bottom: 100, right: 16, zIndex: 1000, padding: '14px', background: isDrawing ? 'white' : PRIMARY_RED, color: isDrawing ? '#333' : 'white', borderRadius: '50%', border: 'none', boxShadow: '0 4px 15px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {isDrawing ? <X size={24} /> : <PenTool size={24} />}
            </button>

            {isDrawing && drawnPolygon.length >= 3 && (
              <button
                onClick={downloadArea}
                disabled={loading}
                style={{ position: 'absolute', bottom: 168, right: 16, zIndex: 1000, padding: '14px', background: SUCCESS_GREEN, color: 'white', borderRadius: '50%', border: 'none', boxShadow: '0 4px 15px rgba(0,200,81,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {loading ? <CloudOff size={24} /> : <Download size={24} />}
              </button>
            )}

            {!isDrawing && (
              <button
                onClick={downloadArea}
                disabled={loading}
                style={{ position: 'absolute', bottom: 168, right: 16, zIndex: 1000, padding: '12px', background: getCardBackground(), color: isDarkMode ? '#fff' : '#333', borderRadius: '50%', border: 'none', boxShadow: '0 4px 15px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {loading ? <CloudOff size={20} /> : <Download size={20} />}
              </button>
            )}

            {!isDrawing && roadGeometry.length === 0 && (
              <button
                onClick={() => setShowRouteMenu(!showRouteMenu)}
                style={{ position: 'absolute', bottom: 228, right: 16, zIndex: 1000, padding: '12px', background: PRIMARY_RED, color: 'white', borderRadius: '50%', border: 'none', boxShadow: '0 4px 15px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title="Route Optionen"
              >
                <Route size={24} />
              </button>
            )}

            {showRouteMenu && !isDrawing && (
              <div style={{ position: 'absolute', bottom: 228, right: 80, zIndex: 1001, background: 'white', borderRadius: 12, padding: 8, boxShadow: '0 8px 25px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button 
                  onClick={() => calculateRoute('unvisited')}
                  style={{ padding: '12px 16px', background: 'none', border: 'none', textAlign: 'left', fontWeight: 'bold', fontSize: 14, color: '#333', borderRadius: 8, whiteSpace: 'nowrap' }}
                >
                  Nur Unbesuchte
                </button>
                <div style={{ height: 1, background: '#eee' }} />
                <button 
                  onClick={() => calculateRoute('yellow')}
                  style={{ padding: '12px 16px', background: 'none', border: 'none', textAlign: 'left', fontWeight: 'bold', fontSize: 14, color: '#333', borderRadius: 8, whiteSpace: 'nowrap' }}
                >
                   Nur Nicht angetroffene
                </button>
                <div style={{ height: 1, background: '#eee' }} />
                <button 
                  onClick={() => calculateRoute('all')}
                  style={{ padding: '12px 16px', background: 'none', border: 'none', textAlign: 'left', fontWeight: 'bold', fontSize: 14, color: '#333', borderRadius: 8, whiteSpace: 'nowrap' }}
                >
                  Alle (Kombiniert)
                </button>
              </div>
            )}


            {!isDrawing && optimizedRoute.length > 0 && (
              <button
                onClick={() => { setOptimizedRoute([]); setRouteHouses([]); setRoadGeometry([]); }}
                style={{ position: 'absolute', bottom: 288, right: 16, zIndex: 1000, padding: '12px', background: 'white', color: PRIMARY_RED, borderRadius: '50%', border: 'none', boxShadow: '0 4px 15px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title="Route löschen"
              >
                <X size={20} />
              </button>
            )}



            {activeTab === 'map' && (
              <div style={{ position: 'absolute', bottom: 32, left: 16, right: 80, zIndex: 1000, display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 10 }}>
                {([
                  { color: 'unvisited', label: 'Grau', hex: '#666' },
                  { color: 'rot', label: 'Rot', hex: PRIMARY_RED },
                  { color: 'gelb', label: 'Gelb', hex: WARNING_YELLOW },
                  { color: 'grün', label: 'Grün', hex: SUCCESS_GREEN }
                ] as const).map(filter => (
                  <button
                    key={filter.color}
                    onClick={() => setActiveFilters(prev => ({ ...prev, [filter.color]: !prev[filter.color] }))}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 20,
                      border: `2px solid ${activeFilters[filter.color] ? filter.hex : isDarkMode ? '#444' : '#ddd'}`,
                      background: activeFilters[filter.color] ? filter.hex : getCardBackground(),
                      color: activeFilters[filter.color] ? 'white' : (isDarkMode ? '#bbb' : '#666'),
                      fontWeight: 'bold',
                      fontSize: 13,
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    <Filter size={14} /> {filter.label}
                  </button>
                ))}
              </div>
            )}

            {isDrawing && (
              <div style={{ position: 'absolute', top: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: PRIMARY_RED, color: 'white', padding: '10px 20px', borderRadius: 20, boxShadow: '0 4px 15px rgba(229,43,56,0.4)', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                Tippe auf die Karte, um den Bereich zu markieren
              </div>
            )}

            {!isDrawing && nextStop && (
              <div style={{ position: 'absolute', top: 80, left: 16, right: 16, zIndex: 1000, background: 'white', padding: '12px 16px', borderRadius: 16, boxShadow: '0 8px 25px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: 12, border: `2px solid ${SUCCESS_GREEN}` }}>
                <div style={{ background: '#2563eb', color: 'white', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', flexShrink: 0 }}>1</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Nächster Stopp</div>
                  <div style={{ fontSize: 16, fontWeight: 'bold', color: '#333' }}>
                    {nextStop.properties?.['addr:street'] || 'Haus'} {nextStop.properties?.['addr:housenumber'] || ''}
                  </div>
                  {streetProgress && (
                    <div style={{ fontSize: 11, color: '#555', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                       <span style={{ fontWeight: 'bold' }}>{streetProgress.name}:</span>
                       <div style={{ flex: 1, height: 4, background: '#eee', borderRadius: 2 }}>
                          <div style={{ width: `${(streetProgress.done / streetProgress.total) * 100}%`, height: '100%', background: SUCCESS_GREEN, borderRadius: 2 }} />
                       </div>
                       <span>{streetProgress.done}/{streetProgress.total}</span>
                    </div>
                  )}
                </div>
                <button 
                  onClick={() => setSelectedFeature(nextStop)}
                  style={{ background: SUCCESS_GREEN, color: 'white', border: 'none', padding: '8px 12px', borderRadius: 8, fontWeight: 'bold', fontSize: 13 }}
                >
                  Status
                </button>
              </div>
            )}





            <MapContainer
              center={[48.2082, 16.3738]} // Start in Vienna
              zoom={17}
              maxZoom={24}
              zoomControl={false} // Better for mobile UI
              ref={mapRef as any}
              style={{ height: '100%', width: '100%' }}
            >
              <MapInteraction isDrawing={isDrawing} onAddPoint={(pt) => setDrawnPolygon(prev => [...prev, pt])} />
              <LocationMarker triggerLocate={locateMe} onLocationFound={(pos) => setUserLocation(pos)} />

              {userLocation && (
                <Marker 
                  position={userLocation} 
                  icon={L.divIcon({ 
                    className: 'user-location-marker', 
                    html: `
                      <div style="position:relative;">
                        <div style="background:#2563eb; width:20px; height:20px; border-radius:50%; border:3px solid white; box-shadow:0 0 15px rgba(37,99,235,0.6); z-index:2; position:relative;"></div>
                        ${!cheatMode ? '<div style="position:absolute; top:-5px; left:-5px; width:30px; height:30px; background:rgba(37,99,235,0.3); border-radius:50%; animation: pulse-gps 2s infinite;"></div>' : ''}
                      </div>
                    `, 
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                  })}
                >
                  <Popup>{cheatMode ? "Simulierter Standort" : "Du bist hier"}</Popup>
                </Marker>
              )}

              <TileLayer
                attribution='&copy; OSM'
                url={isDarkMode
                  ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"}
                maxNativeZoom={isDarkMode ? 20 : 19}
                maxZoom={24}
              />

              {activeTab === 'map' && isDrawing && drawnPolygon.length > 0 && (
                <>
                  <Polyline positions={drawnPolygon} color={PRIMARY_RED} weight={3} dashArray="5, 10" />
                  {drawnPolygon.length >= 3 && (
                    <Polygon positions={drawnPolygon} color={PRIMARY_RED} fillOpacity={0.2} pathOptions={{ interactive: false }} />
                  )}
                  {drawnPolygon.map((pt, idx) => (
                    <Marker key={idx} position={pt} icon={L.divIcon({ className: 'custom-div-icon', html: `<div style="background:${PRIMARY_RED};width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>`, iconSize: [16, 16] })} interactive={false} />
                  ))}
                </>
              )}

              {optimizedRoute.length > 1 && !isDrawing && (
                <>
                  {roadGeometry.length > 1 && (
                    <Polyline 
                      positions={roadGeometry} 
                      color="#2563eb" 
                      weight={5} 
                      opacity={0.8} 
                      lineJoin="round"
                      pathOptions={{ interactive: false }}
                    />
                  )}
                  {optimizedRoute.slice(1).map((pt, idx) => {
                    // Safety check: skip if pt is invalid [0,0]
                    if (!pt || (pt[0] === 0 && pt[1] === 0)) return null;

                    // Only show markers for the next 5 stops relative to the nextStopIndex
                    const isActiveStop = nextStopIndex !== -1 && idx >= nextStopIndex && idx < nextStopIndex + 5;
                    if (!isActiveStop) return null;

                    const relativeNumber = (idx - nextStopIndex) + 1;

                    return (
                      <Marker 
                        key={`${routeHouses[idx]?.id}-${idx}`} 
                        position={pt} 
                        icon={L.divIcon({ 
                          className: `route-dot ${relativeNumber === 1 ? 'next-stop-pulse' : ''}`, 
                          html: `
                            <div style="position:relative; display:flex; flex-direction:column; align-items:center;">
                              <div style="background:#2563eb; width:32px; height:32px; border-radius:50%; border:3px solid white; color:white; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:bold; box-shadow:0 4px 10px rgba(0,0,0,0.3); z-index:2;">
                                ${relativeNumber}
                              </div>
                              <div style="background:white; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:bold; margin-top:4px; box-shadow:0 2px 4px rgba(0,0,0,0.1); border:1px solid #ddd; white-space:nowrap; z-index:1; color:#333;">
                                ${routeHouses[idx]?.properties?.['addr:housenumber'] || ''}
                              </div>
                            </div>
                          `, 
                          iconSize: [40, 50],
                          iconAnchor: [20, 25]
                        })} 
                        eventHandlers={{
                          click: () => setSelectedFeature(routeHouses[idx])
                        }}
                      />
                    );
                  })}
                </>
              )}





              {activeTab === 'heatmap' && (
                <>
                  {heatmapDataGreen.length > 0 && (
                    <HeatmapLayer points={heatmapDataGreen} longitudeExtractor={(m: any) => m[1]} latitudeExtractor={(m: any) => m[0]} intensityExtractor={(m: any) => m[2]} radius={30} blur={20} max={1} gradient={{ 0.4: 'rgba(0,200,81,0)', 1.0: SUCCESS_GREEN }} />
                  )}
                  {heatmapDataYellow.length > 0 && (
                    <HeatmapLayer points={heatmapDataYellow} longitudeExtractor={(m: any) => m[1]} latitudeExtractor={(m: any) => m[0]} intensityExtractor={(m: any) => m[2]} radius={30} blur={20} max={1} gradient={{ 0.4: 'rgba(255,187,51,0)', 1.0: WARNING_YELLOW }} />
                  )}
                  {heatmapDataRed.length > 0 && (
                    <HeatmapLayer points={heatmapDataRed} longitudeExtractor={(m: any) => m[1]} latitudeExtractor={(m: any) => m[0]} intensityExtractor={(m: any) => m[2]} radius={30} blur={20} max={1} gradient={{ 0.4: 'rgba(229,43,56,0)', 1.0: PRIMARY_RED }} />
                  )}
                </>
              )}

              {activeTab === 'map' && buildings && buildings.features.filter((f: any) => {
                const color = statuses[f.id]?.color || 'unvisited';
                return activeFilters[color];
              }).map((feature: any) => (
                <GeoJSON
                  key={`${feature.id}-${roadGeometry.length > 0 ? 'route' : 'normal'}`}
                  data={feature}
                  style={(feat) => {
                    const status = statuses[feat?.id || '']?.color || 'unvisited';
                    const isNext5 = next5Ids.has(feat?.id || '');
                    const isRouting = optimizedRoute.length > 0;

                    
                    if (isRouting && !isNext5) {
                      return {
                        color: 'transparent',
                        weight: 0,
                        fillOpacity: 0,
                        interactive: false
                      }
                    }

                    return {
                      color: isNext5 ? '#2563eb' : (status === 'unvisited' ? '#999' : '#333'),
                      weight: isNext5 ? 3 : (status === 'unvisited' ? 1 : 2),
                      fillColor: getColor(status),
                      fillOpacity: status === 'unvisited' ? 0 : 0.6,
                      interactive: true
                    }
                  }}

                  onEachFeature={(feat, layer) => {
                    layer.on('click', () => {
                      if (!isDrawingRef.current) {
                        handlePolygonClick(feat);
                      }
                    });
                    const housenumber = feat.properties?.['addr:housenumber'];
                    const status = statuses[feat?.id || '']?.color || 'unvisited';
                    // Hide house numbers completely if a route is active
                    const showNumbers = roadGeometry.length === 0;

                    if (housenumber && showNumbers) {
                      layer.bindTooltip(housenumber.toString(), {
                        permanent: true,
                        direction: 'center',
                        className: 'house-label',
                        opacity: status === 'unvisited' ? 0.6 : 1
                      });
                    }

                  }}


                />
              ))}
            </MapContainer>
          </>
        )}

        {activeTab === 'list' && renderList()}
        {activeTab === 'stats' && renderStats()}
      </div>

      {/* Building Details Modal */}
      {selectedFeature && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ background: getCardBackground(), color: isDarkMode ? '#fff' : '#000', width: '100%', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: '24px 20px env(safe-area-inset-bottom)', boxShadow: '0 -4px 20px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20 }}>
                  {selectedFeature.properties?.['addr:street'] || 'Haus'} {selectedFeature.properties?.['addr:housenumber'] || ''}
                </h2>
                <a
                  href={`https://maps.apple.com/?daddr=${selectedFeature.geometry.coordinates[0][0][1]},${selectedFeature.geometry.coordinates[0][0][0]}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: SUCCESS_GREEN, textDecoration: 'none', marginTop: 8, fontSize: 14, fontWeight: 'bold' }}
                >
                  <MapPin size={16} /> Route starten
                </a>
              </div>
              <button onClick={() => setSelectedFeature(null)} style={{ background: 'none', border: 'none', color: '#999', padding: 4 }}>
                <X size={24} />
              </button>
            </div>

            <textarea
              id="note-input"
              placeholder="Notizen (z.B. Komme morgen wieder)"
              defaultValue={statuses[selectedFeature.id]?.note || ''}
              style={{ width: '100%', height: 80, padding: 12, borderRadius: 12, border: `1px solid ${isDarkMode ? '#555' : '#ddd'}`, background: isDarkMode ? '#333' : 'white', color: isDarkMode ? 'white' : 'black', fontSize: 16, marginBottom: 20, boxSizing: 'border-box', fontFamily: 'inherit' }}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
              <button onClick={() => updateStatus(selectedFeature.id, 'grün', (document.getElementById('note-input') as HTMLTextAreaElement).value)} style={{ padding: 16, background: SUCCESS_GREEN, color: 'white', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 'bold' }}>Vertrag erfolgreich</button>
              <button onClick={() => updateStatus(selectedFeature.id, 'gelb', (document.getElementById('note-input') as HTMLTextAreaElement).value)} style={{ padding: 16, background: WARNING_YELLOW, color: '#555', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 'bold' }}>Nicht angetroffen</button>
              <button onClick={() => updateStatus(selectedFeature.id, 'rot', (document.getElementById('note-input') as HTMLTextAreaElement).value)} style={{ padding: 16, background: PRIMARY_RED, color: 'white', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 'bold' }}>Abgelehnt</button>
              <button onClick={() => updateStatus(selectedFeature.id, 'unvisited', '')} style={{ padding: 16, background: '#f0f0f0', color: '#666', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 'bold' }}>Zurücksetzen</button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <div style={{ display: 'flex', background: isDarkMode ? '#1a1a1a' : 'white', borderTop: `1px solid ${isDarkMode ? '#333' : '#eee'}`, paddingBottom: 'env(safe-area-inset-bottom)', boxShadow: '0 -2px 10px rgba(0,0,0,0.05)', position: 'relative', zIndex: 1500 }}>
        {[
          { id: 'map', icon: <MapIcon size={24} />, label: 'Karte' },
          { id: 'heatmap', icon: <Layers size={24} />, label: 'Heatmap' },
          { id: 'list', icon: <List size={24} />, label: 'Liste' },
          { id: 'stats', icon: <BarChart2 size={24} />, label: 'Stats' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as Tab)}
            style={{
              flex: 1,
              padding: '10px 0',
              border: 'none',
              background: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              color: activeTab === tab.id ? PRIMARY_RED : (isDarkMode ? '#666' : '#999'),
              transition: 'color 0.2s'
            }}
          >
            {tab.icon}
            <span style={{ fontSize: '11px', marginTop: 6, fontWeight: activeTab === tab.id ? 600 : 400 }}>{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default App;
