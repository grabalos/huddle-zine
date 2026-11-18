(() => {
  'use strict';

  /* ------------------------------------------------------------------
   * Which music plays.
   * To swap it: in Spotify, open the playlist → Share → Copy link to playlist.
   * The link looks like https://open.spotify.com/playlist/<ID>?si=...
   * Paste that <ID> below. Albums and tracks work too:
   *   'spotify:album:<ID>'  or  'spotify:track:<ID>'
   * ------------------------------------------------------------------ */
  const SPOTIFY_URI = 'spotify:playlist:37i9dQZF1DX6RSJAsEDz7H';

  const LOAD_TIMEOUT_MS = 8000;

  const player = document.getElementById('player');
  const mount = document.getElementById('spotifyEmbed');
  let loaded = false;

  // Called by the Spotify iFrame API script once it has loaded.
  window.onSpotifyIframeApiReady = (IFrameAPI) => {
    IFrameAPI.createController(mount, { uri: SPOTIFY_URI, width: '100%', height: 80 }, () => {
      loaded = true;
    });
  };

  // No network (or Spotify blocked): hide the player instead of showing an empty box.
  setTimeout(() => {
    if (!loaded) player.hidden = true;
  }, LOAD_TIMEOUT_MS);
})();
