export function hasValidCoordinates(lat: number | string | null | undefined, lng: number | string | null | undefined) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude);
}

export function getGoogleMapsUrl(lat: number | string | null | undefined, lng: number | string | null | undefined) {
  if (!hasValidCoordinates(lat, lng)) return "";
  return `https://www.google.com/maps/search/?api=1&query=${Number(lat)},${Number(lng)}`;
}

export function getGoogleMapsEmbedUrl(lat: number | string | null | undefined, lng: number | string | null | undefined, zoom = 17) {
  if (!hasValidCoordinates(lat, lng)) return "";
  return `https://maps.google.com/maps?q=${Number(lat)},${Number(lng)}&z=${zoom}&output=embed`;
}
