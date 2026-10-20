import { isValidId } from './fsUtils.js';

// Identity is fixed when the socket connects (handshake `auth`), never taken from event payloads:
//   host:   { role: 'host', pin, hostSecret }
//   player: { role: 'player', userUuid, pin? }  (pin = the game the page is showing, if any)
// Clients reconnect with the same auth, so a reconnecting socket is re-attached and receives the
// current game state before any event it buffered while offline is processed.
export function registerSocketHandlers(io, gameManager) {
  io.on('connection', (socket) => {
    const auth = socket.handshake.auth || {};

    const logError = (context, err) => {
      console.error(`Error handling ${context}:`, err);
      gameManager.getGameByPin(socket.data.pin)?.logger?.exception(context, err, { socketId: socket.id });
    };

    const on = (event, handler) =>
      socket.on(event, (...args) => {
        try {
          handler(...args);
        } catch (err) {
          logError(event, err);
        }
      });

    // The game this socket is attached to in the given role, if any
    const boundGame = (role) => (socket.data.role === role ? gameManager.getGameByPin(socket.data.pin) : null);

    const onHost = (event, handler) =>
      on(event, (data = {}) => {
        const game = boundGame('host');
        if (game) handler(game, data);
      });

    try {
      if (auth.role === 'host') {
        const game = gameManager.getGameByPinOrId(auth.pin);
        if (!game || auth.hostSecret !== game.hostSecret) {
          game?.logger?.unusualRequest('UNAUTHORIZED_HOST_JOIN', socket.id, { pin: auth.pin });
          socket.emit('host_error', { error: game ? 'Unauthorized host session' : 'Game not found or has ended' });
        } else {
          gameManager.attachHost(socket, game);
        }
      } else if (auth.role === 'player' && isValidId(auth.userUuid)) {
        const game = auth.pin ? gameManager.getGameByPinOrId(auth.pin) : null;
        if (game?.players.has(auth.userUuid)) {
          gameManager.attachPlayer(socket, game, auth.userUuid, true);
        } else {
          socket.emit('not_joined', { gameFound: Boolean(game) });
        }
      }
    } catch (err) {
      logError('connection', err);
    }

    on('player_join', (data = {}) => {
      const { pin, nickname, avatar } = data;
      const result = gameManager.joinPlayer(pin, nickname, auth.userUuid, avatar);
      if (!result.success) {
        socket.emit('join_error', { error: result.error });
        return;
      }
      gameManager.attachPlayer(socket, result.game, auth.userUuid, result.isReconnect);
    });

    // Acknowledged so the client knows whether to keep (and resend) its pending answer
    on('player_submit_answer', (data = {}, ack) => {
      const game = boundGame('player');
      const result = game
        ? gameManager.submitAnswer(game, socket.data.userUuid, data.questionIndex, data.answer)
        : { success: false, error: 'Please join the game first' };
      if (typeof ack === 'function') ack(result);
    });

    // "Play another game": stop receiving this game's events on this socket
    on('player_leave', () => gameManager.detach(socket));

    on('player_update_avatar', (data = {}) => {
      const game = boundGame('player');
      if (game) gameManager.updatePlayerAvatar(game, socket.data.userUuid, data.avatar);
    });

    onHost('host_update_settings', (game, { settings }) => gameManager.updateSettings(game, settings || {}));
    onHost('host_start_game', (game) => gameManager.startGame(game));
    onHost('host_end_game', (game) => gameManager.endGame(game));
    onHost('host_kick_player', (game, { userUuid }) => gameManager.kickPlayer(game, userUuid));
    onHost('host_next', (game, { fromState, questionIndex }) =>
      gameManager.handleHostNext(game, fromState, questionIndex)
    );

    on('disconnect', () => gameManager.handleDisconnect(socket));
  });
}
