// Aree candidate per l'estrazione dei round.
// Ogni area e' un punto attorno al quale il server cerca immagini Mapillary.
// La copertura Mapillary e' collaborativa: alcune aree possono risultare vuote,
// per questo il server prova piu' aree in sequenza prima di arrendersi.
//
// scope: 'italia' implica anche europa e mondo; 'europa' implica anche mondo.

const IT = (name, lat, lng) => ({ name, country: 'Italia', lat, lng, scope: 'italia' });
const EU = (name, country, lat, lng) => ({ name, country, lat, lng, scope: 'europa' });
const WW = (name, country, lat, lng) => ({ name, country, lat, lng, scope: 'mondo' });

export const AREAS = [
  // ---------------- Italia ----------------
  IT('Roma - Centro', 41.8955, 12.4823),
  IT('Roma - EUR', 41.8339, 12.4698),
  IT('Roma - Trastevere', 41.8892, 12.4694),
  IT('Milano - Duomo', 45.4642, 9.1900),
  IT('Milano - Navigli', 45.4508, 9.1745),
  IT('Milano - Bicocca', 45.5158, 9.2114),
  IT('Torino - Centro', 45.0703, 7.6869),
  IT('Torino - Lingotto', 45.0322, 7.6636),
  IT('Genova - Porto Antico', 44.4090, 8.9270),
  IT('Napoli - Centro', 40.8518, 14.2681),
  IT('Napoli - Vomero', 40.8449, 14.2287),
  IT('Palermo - Centro', 38.1157, 13.3615),
  IT('Catania - Centro', 37.5079, 15.0830),
  IT('Bologna - Centro', 44.4949, 11.3426),
  IT('Firenze - Centro', 43.7696, 11.2558),
  IT('Firenze - Oltrarno', 43.7654, 11.2470),
  IT('Venezia - Cannaregio', 45.4419, 12.3260),
  IT('Verona - Centro', 45.4384, 10.9916),
  IT('Padova - Centro', 45.4064, 11.8768),
  IT('Trieste - Centro', 45.6495, 13.7768),
  IT('Udine - Centro', 46.0637, 13.2350),
  IT('Bolzano - Centro', 46.4983, 11.3548),
  IT('Trento - Centro', 46.0679, 11.1211),
  IT('Bergamo - Citta Alta', 45.7038, 9.6626),
  IT('Brescia - Centro', 45.5416, 10.2118),
  IT('Como - Lungolago', 45.8081, 9.0852),
  IT('Parma - Centro', 44.8015, 10.3279),
  IT('Modena - Centro', 44.6471, 10.9252),
  IT('Rimini - Marina', 44.0678, 12.5695),
  IT('Ravenna - Centro', 44.4184, 12.2035),
  IT('Ancona - Porto', 43.6158, 13.5189),
  IT('Perugia - Centro', 43.1107, 12.3908),
  IT('Assisi', 43.0707, 12.6196),
  IT('Siena - Centro', 43.3188, 11.3308),
  IT('Pisa - Centro', 43.7160, 10.3966),
  IT('Livorno - Porto', 43.5485, 10.3106),
  IT('La Spezia - Centro', 44.1025, 9.8241),
  IT('Cinque Terre - Monterosso', 44.1462, 9.6547),
  IT('Sanremo - Centro', 43.8159, 7.7761),
  IT('Aosta - Centro', 45.7372, 7.3206),
  IT('Novara - Centro', 45.4469, 8.6217),
  IT('Alessandria - Centro', 44.9133, 8.6153),
  IT('Piacenza - Centro', 45.0526, 9.6930),
  IT('Pescara - Lungomare', 42.4643, 14.2142),
  IT("L'Aquila - Centro", 42.3498, 13.3995),
  IT('Bari - Centro', 41.1258, 16.8620),
  IT('Lecce - Centro', 40.3515, 18.1750),
  IT('Taranto - Centro', 40.4762, 17.2298),
  IT('Matera - Sassi', 40.6664, 16.6043),
  IT('Cosenza - Centro', 39.2986, 16.2536),
  IT('Reggio Calabria - Lungomare', 38.1100, 15.6480),
  IT('Messina - Centro', 38.1938, 15.5540),
  IT('Siracusa - Ortigia', 37.0602, 15.2933),
  IT('Agrigento - Centro', 37.3111, 13.5765),
  IT('Cagliari - Centro', 39.2166, 9.1128),
  IT('Sassari - Centro', 40.7259, 8.5556),
  IT('Olbia - Centro', 40.9236, 9.4989),
  IT('Salerno - Lungomare', 40.6766, 14.7639),
  IT('Sorrento - Centro', 40.6263, 14.3757),
  IT('Caserta - Centro', 41.0723, 14.3323),

  // ---------------- Europa ----------------
  EU('Parigi - Centro', 'Francia', 48.8566, 2.3522),
  EU('Parigi - Montmartre', 'Francia', 48.8867, 2.3431),
  EU('Lione - Presqu Ile', 'Francia', 45.7640, 4.8357),
  EU('Marsiglia - Vieux Port', 'Francia', 43.2951, 5.3739),
  EU('Bordeaux - Centro', 'Francia', 44.8378, -0.5792),
  EU('Nizza - Promenade', 'Francia', 43.6961, 7.2650),
  EU('Strasburgo - Centro', 'Francia', 48.5734, 7.7521),
  EU('Berlino - Mitte', 'Germania', 52.5200, 13.4050),
  EU('Berlino - Kreuzberg', 'Germania', 52.4979, 13.4180),
  EU('Amburgo - Centro', 'Germania', 53.5511, 9.9937),
  EU('Monaco di Baviera', 'Germania', 48.1351, 11.5820),
  EU('Colonia - Centro', 'Germania', 50.9375, 6.9603),
  EU('Francoforte - Centro', 'Germania', 50.1109, 8.6821),
  EU('Dresda - Centro', 'Germania', 51.0504, 13.7373),
  EU('Lipsia - Centro', 'Germania', 51.3397, 12.3731),
  EU('Amsterdam - Centro', 'Paesi Bassi', 52.3676, 4.9041),
  EU('Rotterdam - Centro', 'Paesi Bassi', 51.9244, 4.4777),
  EU('Utrecht - Centro', 'Paesi Bassi', 52.0907, 5.1214),
  EU('Bruxelles - Centro', 'Belgio', 50.8503, 4.3517),
  EU('Anversa - Centro', 'Belgio', 51.2194, 4.4025),
  EU('Gand - Centro', 'Belgio', 51.0543, 3.7174),
  EU('Lussemburgo', 'Lussemburgo', 49.6116, 6.1319),
  EU('Zurigo - Centro', 'Svizzera', 47.3769, 8.5417),
  EU('Ginevra - Centro', 'Svizzera', 46.2044, 6.1432),
  EU('Berna - Centro', 'Svizzera', 46.9480, 7.4474),
  EU('Lugano - Centro', 'Svizzera', 46.0037, 8.9511),
  EU('Vienna - Centro', 'Austria', 48.2082, 16.3738),
  EU('Salisburgo - Centro', 'Austria', 47.8095, 13.0550),
  EU('Innsbruck - Centro', 'Austria', 47.2692, 11.4041),
  EU('Madrid - Centro', 'Spagna', 40.4168, -3.7038),
  EU('Barcellona - Eixample', 'Spagna', 41.3874, 2.1686),
  EU('Valencia - Centro', 'Spagna', 39.4699, -0.3763),
  EU('Siviglia - Centro', 'Spagna', 37.3891, -5.9845),
  EU('Bilbao - Centro', 'Spagna', 43.2630, -2.9350),
  EU('Malaga - Centro', 'Spagna', 36.7213, -4.4214),
  EU('Lisbona - Baixa', 'Portogallo', 38.7223, -9.1393),
  EU('Porto - Ribeira', 'Portogallo', 41.1408, -8.6116),
  EU('Londra - Westminster', 'Regno Unito', 51.5007, -0.1246),
  EU('Londra - Shoreditch', 'Regno Unito', 51.5265, -0.0784),
  EU('Manchester - Centro', 'Regno Unito', 53.4808, -2.2426),
  EU('Edimburgo - Centro', 'Regno Unito', 55.9533, -3.1883),
  EU('Glasgow - Centro', 'Regno Unito', 55.8642, -4.2518),
  EU('Bristol - Centro', 'Regno Unito', 51.4545, -2.5879),
  EU('Dublino - Centro', 'Irlanda', 53.3498, -6.2603),
  EU('Copenaghen - Centro', 'Danimarca', 55.6761, 12.5683),
  EU('Aarhus - Centro', 'Danimarca', 56.1629, 10.2039),
  EU('Stoccolma - Gamla Stan', 'Svezia', 59.3251, 18.0711),
  EU('Goteborg - Centro', 'Svezia', 57.7089, 11.9746),
  EU('Malmo - Centro', 'Svezia', 55.6050, 13.0038),
  EU('Oslo - Centro', 'Norvegia', 59.9139, 10.7522),
  EU('Bergen - Centro', 'Norvegia', 60.3913, 5.3221),
  EU('Helsinki - Centro', 'Finlandia', 60.1699, 24.9384),
  EU('Tampere - Centro', 'Finlandia', 61.4978, 23.7610),
  EU('Tallinn - Centro', 'Estonia', 59.4370, 24.7536),
  EU('Riga - Centro', 'Lettonia', 56.9496, 24.1052),
  EU('Vilnius - Centro', 'Lituania', 54.6872, 25.2797),
  EU('Varsavia - Centro', 'Polonia', 52.2297, 21.0122),
  EU('Cracovia - Centro', 'Polonia', 50.0647, 19.9450),
  EU('Danzica - Centro', 'Polonia', 54.3520, 18.6466),
  EU('Praga - Centro', 'Cechia', 50.0755, 14.4378),
  EU('Brno - Centro', 'Cechia', 49.1951, 16.6068),
  EU('Bratislava - Centro', 'Slovacchia', 48.1486, 17.1077),
  EU('Budapest - Centro', 'Ungheria', 47.4979, 19.0402),
  EU('Lubiana - Centro', 'Slovenia', 46.0569, 14.5058),
  EU('Zagabria - Centro', 'Croazia', 45.8150, 15.9819),
  EU('Spalato - Centro', 'Croazia', 43.5081, 16.4402),
  EU('Belgrado - Centro', 'Serbia', 44.7866, 20.4489),
  EU('Sofia - Centro', 'Bulgaria', 42.6977, 23.3219),
  EU('Bucarest - Centro', 'Romania', 44.4268, 26.1025),
  EU('Cluj-Napoca - Centro', 'Romania', 46.7712, 23.6236),
  EU('Atene - Centro', 'Grecia', 37.9838, 23.7275),
  EU('Salonicco - Centro', 'Grecia', 40.6401, 22.9444),
  EU('Reykjavik - Centro', 'Islanda', 64.1466, -21.9426),
  EU('Valletta', 'Malta', 35.8989, 14.5146),
  EU('Nicosia - Centro', 'Cipro', 35.1856, 33.3823),

  // ---------------- Resto del mondo ----------------
  WW('New York - Manhattan', 'Stati Uniti', 40.7580, -73.9855),
  WW('New York - Brooklyn', 'Stati Uniti', 40.6782, -73.9442),
  WW('San Francisco - Centro', 'Stati Uniti', 37.7749, -122.4194),
  WW('Los Angeles - Downtown', 'Stati Uniti', 34.0522, -118.2437),
  WW('Chicago - Loop', 'Stati Uniti', 41.8781, -87.6298),
  WW('Seattle - Downtown', 'Stati Uniti', 47.6062, -122.3321),
  WW('Boston - Centro', 'Stati Uniti', 42.3601, -71.0589),
  WW('Austin - Downtown', 'Stati Uniti', 30.2672, -97.7431),
  WW('Miami - Centro', 'Stati Uniti', 25.7617, -80.1918),
  WW('Denver - Downtown', 'Stati Uniti', 39.7392, -104.9903),
  WW('Portland - Downtown', 'Stati Uniti', 45.5152, -122.6784),
  WW('Washington - Mall', 'Stati Uniti', 38.8895, -77.0353),
  WW('New Orleans - Centro', 'Stati Uniti', 29.9511, -90.0715),
  WW('Toronto - Downtown', 'Canada', 43.6532, -79.3832),
  WW('Montreal - Centro', 'Canada', 45.5019, -73.5674),
  WW('Vancouver - Downtown', 'Canada', 49.2827, -123.1207),
  WW('Citta del Messico - Centro', 'Messico', 19.4326, -99.1332),
  WW('Guadalajara - Centro', 'Messico', 20.6597, -103.3496),
  WW('Bogota - Centro', 'Colombia', 4.7110, -74.0721),
  WW('Medellin - Centro', 'Colombia', 6.2442, -75.5812),
  WW('Lima - Miraflores', 'Peru', -12.1211, -77.0296),
  WW('Santiago - Centro', 'Cile', -33.4489, -70.6693),
  WW('Buenos Aires - Centro', 'Argentina', -34.6037, -58.3816),
  WW('San Paolo - Centro', 'Brasile', -23.5505, -46.6333),
  WW('Rio de Janeiro - Copacabana', 'Brasile', -22.9711, -43.1822),
  WW('Curitiba - Centro', 'Brasile', -25.4284, -49.2733),
  WW('Montevideo - Centro', 'Uruguay', -34.9011, -56.1645),
  WW('Tokyo - Shibuya', 'Giappone', 35.6595, 139.7005),
  WW('Tokyo - Asakusa', 'Giappone', 35.7148, 139.7967),
  WW('Osaka - Namba', 'Giappone', 34.6659, 135.5010),
  WW('Kyoto - Centro', 'Giappone', 35.0116, 135.7681),
  WW('Sapporo - Centro', 'Giappone', 43.0618, 141.3545),
  WW('Seoul - Gangnam', 'Corea del Sud', 37.4979, 127.0276),
  WW('Busan - Centro', 'Corea del Sud', 35.1796, 129.0756),
  WW('Taipei - Centro', 'Taiwan', 25.0330, 121.5654),
  WW('Kaohsiung - Centro', 'Taiwan', 22.6273, 120.3014),
  WW('Hong Kong - Central', 'Hong Kong', 22.2810, 114.1580),
  WW('Singapore - Centro', 'Singapore', 1.3000, 103.8500),
  WW('Bangkok - Centro', 'Thailandia', 13.7563, 100.5018),
  WW('Chiang Mai - Centro', 'Thailandia', 18.7883, 98.9853),
  WW('Kuala Lumpur - Centro', 'Malesia', 3.1390, 101.6869),
  WW('Giacarta - Centro', 'Indonesia', -6.2088, 106.8456),
  WW('Manila - Centro', 'Filippine', 14.5995, 120.9842),
  WW('Ho Chi Minh - Centro', 'Vietnam', 10.7769, 106.7009),
  WW('Hanoi - Centro', 'Vietnam', 21.0278, 105.8342),
  WW('Nuova Delhi - Connaught', 'India', 28.6315, 77.2167),
  WW('Mumbai - Centro', 'India', 19.0760, 72.8777),
  WW('Bangalore - Centro', 'India', 12.9716, 77.5946),
  WW('Colombo - Centro', 'Sri Lanka', 6.9271, 79.8612),
  WW('Kathmandu - Centro', 'Nepal', 27.7172, 85.3240),
  WW('Tel Aviv - Centro', 'Israele', 32.0853, 34.7818),
  WW('Gerusalemme - Centro', 'Israele', 31.7683, 35.2137),
  WW('Amman - Centro', 'Giordania', 31.9539, 35.9106),
  WW('Istanbul - Sultanahmet', 'Turchia', 41.0082, 28.9784),
  WW('Izmir - Centro', 'Turchia', 38.4237, 27.1428),
  WW('Dubai - Downtown', 'Emirati Arabi Uniti', 25.1972, 55.2744),
  WW('Doha - Centro', 'Qatar', 25.2854, 51.5310),
  WW('Il Cairo - Centro', 'Egitto', 30.0444, 31.2357),
  WW('Marrakech - Medina', 'Marocco', 31.6295, -7.9811),
  WW('Casablanca - Centro', 'Marocco', 33.5731, -7.5898),
  WW('Tunisi - Centro', 'Tunisia', 36.8065, 10.1815),
  WW('Nairobi - Centro', 'Kenya', -1.2921, 36.8219),
  WW('Kampala - Centro', 'Uganda', 0.3476, 32.5825),
  WW('Accra - Centro', 'Ghana', 5.6037, -0.1870),
  WW('Lagos - Centro', 'Nigeria', 6.5244, 3.3792),
  WW('Citta del Capo - Centro', 'Sudafrica', -33.9249, 18.4241),
  WW('Johannesburg - Centro', 'Sudafrica', -26.2041, 28.0473),
  WW('Sydney - CBD', 'Australia', -33.8688, 151.2093),
  WW('Melbourne - CBD', 'Australia', -37.8136, 144.9631),
  WW('Brisbane - CBD', 'Australia', -27.4698, 153.0251),
  WW('Perth - CBD', 'Australia', -31.9505, 115.8605),
  WW('Auckland - Centro', 'Nuova Zelanda', -36.8485, 174.7633),
  WW('Wellington - Centro', 'Nuova Zelanda', -41.2866, 174.7756),
  WW('Mosca - Centro', 'Russia', 55.7558, 37.6173),
  WW('San Pietroburgo - Centro', 'Russia', 59.9311, 30.3609),
  WW('Kiev - Centro', 'Ucraina', 50.4501, 30.5234),
  WW('Tbilisi - Centro', 'Georgia', 41.7151, 44.8271),
  WW('Erevan - Centro', 'Armenia', 40.1792, 44.4991),
  WW('Almaty - Centro', 'Kazakistan', 43.2220, 76.8512),
];

export function areasForScope(scope) {
  if (scope === 'italia') return AREAS.filter((a) => a.scope === 'italia');
  if (scope === 'europa') return AREAS.filter((a) => a.scope === 'italia' || a.scope === 'europa');
  return AREAS;
}

export const SCOPES = {
  mondo: 'Mondo',
  europa: 'Europa',
  italia: 'Italia',
};

/* ---------------------------------------------------------------- aiutini */

// Continente di ogni paese presente nell'elenco. Serve solo all'aiutino:
// dire "Sud America" restringe molto senza regalare la risposta.
const CONTINENTI = {
  Italia: 'Europa', Francia: 'Europa', Germania: 'Europa', Spagna: 'Europa',
  Portogallo: 'Europa', 'Regno Unito': 'Europa', Irlanda: 'Europa', Belgio: 'Europa',
  'Paesi Bassi': 'Europa', Lussemburgo: 'Europa', Svizzera: 'Europa', Austria: 'Europa',
  Danimarca: 'Europa', Svezia: 'Europa', Norvegia: 'Europa', Finlandia: 'Europa',
  Islanda: 'Europa', Estonia: 'Europa', Lettonia: 'Europa', Lituania: 'Europa',
  Polonia: 'Europa', Cechia: 'Europa', Slovacchia: 'Europa', Ungheria: 'Europa',
  Slovenia: 'Europa', Croazia: 'Europa', Serbia: 'Europa', Bulgaria: 'Europa',
  Romania: 'Europa', Grecia: 'Europa', Malta: 'Europa', Cipro: 'Europa',
  Ucraina: 'Europa', Russia: 'Europa',
  'Stati Uniti': 'Nord America', Canada: 'Nord America', Messico: 'Nord America',
  Colombia: 'Sud America', Peru: 'Sud America', Cile: 'Sud America',
  Argentina: 'Sud America', Brasile: 'Sud America', Uruguay: 'Sud America',
  Giappone: 'Asia', 'Corea del Sud': 'Asia', Taiwan: 'Asia', 'Hong Kong': 'Asia',
  Singapore: 'Asia', Thailandia: 'Asia', Malesia: 'Asia', Indonesia: 'Asia',
  Filippine: 'Asia', Vietnam: 'Asia', India: 'Asia', 'Sri Lanka': 'Asia',
  Nepal: 'Asia', Israele: 'Asia', Giordania: 'Asia', Turchia: 'Asia',
  'Emirati Arabi Uniti': 'Asia', Qatar: 'Asia', Georgia: 'Asia', Armenia: 'Asia',
  Kazakistan: 'Asia',
  Egitto: 'Africa', Marocco: 'Africa', Tunisia: 'Africa', Kenya: 'Africa',
  Uganda: 'Africa', Ghana: 'Africa', Nigeria: 'Africa', Sudafrica: 'Africa',
  Australia: 'Oceania', 'Nuova Zelanda': 'Oceania',
};

/** Zona d'Europa, per l'aiutino in modalita' Europa. */
function zonaEuropa(lat, lng) {
  if (lat >= 55) return 'Europa settentrionale';
  if (lat < 43) return lng < 12 ? 'Europa sud-occidentale' : 'Europa sud-orientale';
  if (lng < 3) return 'Europa occidentale';
  if (lng > 20) return 'Europa orientale';
  return 'Europa centrale';
}

/** Zona d'Italia, per l'aiutino in modalita' Italia. */
function zonaItalia(lat, lng) {
  if (lng < 10 && lat < 41.5) return 'Sardegna';
  if (lat < 38.5) return 'Sicilia';
  if (lat >= 44) return 'Nord Italia';
  if (lat >= 41.6) return 'Centro Italia';
  return 'Sud Italia';
}

/**
 * L'indizio che l'aiutino rivela: tanto piu' stretto quanto piu' e' stretto
 * l'ambito di gioco, cosi' resta utile senza mai regalare la risposta.
 */
export function indizio({ lat, lng, country }, scope) {
  if (scope === 'italia') return zonaItalia(lat, lng);
  if (scope === 'europa') return zonaEuropa(lat, lng);
  return CONTINENTI[country] || 'Continente sconosciuto';
}
