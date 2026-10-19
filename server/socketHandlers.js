export function registerSocketHandlers(io, gameManager) {
  io.on('connection', (socket) => {
    // Helper to retrieve player info bound to this socket
    const playerOf = (sock) => {
      const info = gameManager.socketToGame.get(sock.id);
      return info?.role === 'player' ? info : null;
    };

    // Helper to resolve or bind player identity across websocket sessions
    const resolvePlayer = (sock, data = {}) => {
      let me = playerOf(sock);
      if (me) return me;

      const pin = data.pin || data.answerPayload?.pin;
      const userUuid = data.userUuid || data.answerPayload?.userUuid;
      if (pin && userUuid) {
        const bound = gameManager.bindSocketToUser(pin, userUuid, sock);
        if (bound) return bound;
      }
      return null;
    };

    // Helper to verify authorized host
    const isAuthorizedHost = (sock, pin, hostSecret) => {
      const game = gameManager.getGameByPinOrId(pin);
      if (!game) return false;
      const socketInfo = gameManager.socketToGame.get(sock.id);
      if (socketInfo && socketInfo.role === 'host' && socketInfo.pin === game.pin) {
        return true;
      }
      if (hostSecret && game.hostSecret && hostSecret === game.hostSecret) {
        return true;
      }
      if (game.hostSocketId === sock.id) {
        return true;
      }
      game.logger?.unusualRequest('UNAUTHORIZED_HOST', sock.id, {
        pin: game.pin,
        hasHostSecret: Boolean(hostSecret),
        socketRole: socketInfo?.role || null,
      });
      return false;
    };

    // Host joins / reconnects to game room
    socket.on('host_join', (data) => {
      try {
        const { pin, hostSecret } = data || {};
        const game = gameManager.getGameByPinOrId(pin);
        if (game) {
          if (game.hostSecret && hostSecret !== game.hostSecret) {
            game.logger?.unusualRequest('UNAUTHORIZED_HOST_JOIN', socket.id, { pin: game.pin });
            socket.emit('host_error', { error: 'Unauthorized host session' });
            return;
          }
          game.hostSocketId = socket.id;
          socket.join(game.pin);
          gameManager.socketToGame.set(socket.id, {
            pin: game.pin,
            role: 'host',
            hostSecret: game.hostSecret,
          });
          game.logger?.info('HOST_CONNECT', `Host joined/reconnected via socket ${socket.id}`, { socketId: socket.id });
          const hostData = gameManager.getHostStateData(game.pin);
          socket.emit('host_game_data', {
            ...(hostData || {}),
            hostSecret: game.hostSecret,
          });
        } else {
          socket.emit('host_error', { error: 'Game not found or has ended' });
        }
      } catch (err) {
        console.error('Error handling host_join:', err);
        const game = gameManager.getGameByPinOrId(data?.pin);
        game?.logger?.exception('host_join', err, { socketId: socket.id });
        socket.emit('host_error', { error: 'Failed to join host room' });
      }
    });

    // Host updates game settings
    socket.on('host_update_settings', (data) => {
      try {
        const { pin, settings, hostSecret } = data || {};
        if (!isAuthorizedHost(socket, pin, hostSecret)) return;
        gameManager.updateSettings(pin, settings);
      } catch (err) {
        console.error('Error handling host_update_settings:', err);
        const game = gameManager.getGameByPinOrId(data?.pin);
        game?.logger?.exception('host_update_settings', err, { socketId: socket.id });
      }
    });

    // Host starts game
    socket.on('host_start_game', (data) => {
      try {
        const { pin, hostSecret } = data || {};
        if (!isAuthorizedHost(socket, pin, hostSecret)) return;
        const success = gameManager.startGame(pin);
        if (!success) {
          socket.emit('game_error', { error: 'Could not start game' });
        }
      } catch (err) {
        console.error('Error handling host_start_game:', err);
        const game = gameManager.getGameByPinOrId(data?.pin);
        game?.logger?.exception('host_start_game', err, { socketId: socket.id });
        socket.emit('game_error', { error: 'Could not start game' });
      }
    });

    // Host ends game immediately
    socket.on('host_end_game', (data) => {
      try {
        const { pin, hostSecret } = data || {};
        if (!isAuthorizedHost(socket, pin, hostSecret)) return;
        gameManager.endGame(pin);
      } catch (err) {
        console.error('Error handling host_end_game:', err);
        const game = gameManager.getGameByPinOrId(data?.pin);
        game?.logger?.exception('host_end_game', err, { socketId: socket.id });
      }
    });

    // Host kicks player
    socket.on('host_kick_player', (data) => {
      try {
        const { pin, userUuid, hostSecret } = data || {};
        if (!isAuthorizedHost(socket, pin, hostSecret)) return;
        gameManager.kickPlayer(pin, userUuid);
      } catch (err) {
        console.error('Error handling host_kick_player:', err);
        const game = gameManager.getGameByPinOrId(data?.pin);
        game?.logger?.exception('host_kick_player', err, { socketId: socket.id });
      }
    });

    // Host clicks next / skip (both dispatch to guarded handleHostNext)
    socket.on('host_next', (data) => {
      try {
        const { pin, hostSecret } = data || {};
        if (!isAuthorizedHost(socket, pin, hostSecret)) return;
        gameManager.handleHostNext(pin);
      } catch (err) {
        console.error('Error handling host_next:', err);
        const game = gameManager.getGameByPinOrId(data?.pin);
        game?.logger?.exception('host_next', err, { socketId: socket.id });
      }
    });

    socket.on('host_skip', (data) => {
      try {
        const { pin, hostSecret } = data || {};
        if (!isAuthorizedHost(socket, pin, hostSecret)) return;
        gameManager.handleHostNext(pin);
      } catch (err) {
        console.error('Error handling host_skip:', err);
        const game = gameManager.getGameByPinOrId(data?.pin);
        game?.logger?.exception('host_skip', err, { socketId: socket.id });
      }
    });

    // Player joins game
    socket.on('player_join', (data = {}) => {
      try {
        const { pin, nickname, userUuid, avatar } = data;
        const result = gameManager.joinPlayer(pin, nickname, userUuid, socket.id, avatar);

        if (!result.success) {
          const game = gameManager.getGameByPinOrId(pin);
          game?.logger?.warn('PLAYER_JOIN_REJECTED', `Player join rejected for "${nickname}": ${result.error}`, {
            pin,
            nickname,
            userUuid,
            socketId: socket.id,
            error: result.error,
          });
          socket.emit('join_error', { error: result.error || 'Failed to join game' });
          return;
        }

        socket.join(result.pin);
        socket.emit('join_success', result);

        const game = gameManager.getGameByPin(result.pin);
        if (game) {
          for (const [event, payload] of gameManager.getPlayerResumeEvents(game, result.player.userUuid)) {
            socket.emit(event, payload);
          }
        }
      } catch (err) {
        console.error('Error handling player_join:', err);
        const game = gameManager.getGameByPinOrId(data?.pin);
        game?.logger?.exception('player_join', err, { socketId: socket.id, data });
        socket.emit('join_error', { error: 'Failed to join game' });
      }
    });

    // Player submits answer: identity bound cleanly across sessions
    socket.on('player_submit_answer', (data = {}) => {
      let me = null;
      try {
        me = resolvePlayer(socket, data);
        const answerPayload = data.answerPayload ?? data;

        if (!me) {
          const pin = data.pin || data.answerPayload?.pin;
          const game = pin ? gameManager.getGameByPinOrId(pin) : null;
          game?.logger?.unusualRequest('SUBMIT_WITHOUT_SESSION', socket.id, {
            data,
            resolvedPin: pin,
          });
          socket.emit('answer_submitted_ack', { success: false, error: 'Please join the game first' });
          return;
        }
        const result = gameManager.submitAnswer(me.pin, me.userUuid, answerPayload);
        socket.emit('answer_submitted_ack', result);
      } catch (err) {
        console.error('Error handling player_submit_answer:', err);
        const game = me?.pin ? gameManager.getGameByPinOrId(me.pin) : null;
        game?.logger?.exception('player_submit_answer', err, { socketId: socket.id, userUuid: me?.userUuid });
        socket.emit('answer_submitted_ack', { success: false, error: 'Failed to submit answer' });
      }
    });

    // Player updates custom avatar emoji
    socket.on('player_update_avatar', (data = {}) => {
      let me = null;
      try {
        me = resolvePlayer(socket, data);
        if (!me) {
          const pin = data.pin;
          const game = pin ? gameManager.getGameByPinOrId(pin) : null;
          game?.logger?.unusualRequest('AVATAR_WITHOUT_SESSION', socket.id, { data });
          return;
        }
        const avatar = data.avatar;
        if (gameManager.updatePlayerAvatar(me.pin, me.userUuid, avatar)) {
          socket.emit('player_avatar_updated', { avatar });
        }
      } catch (err) {
        console.error('Error handling player_update_avatar:', err);
        const game = me?.pin ? gameManager.getGameByPinOrId(me.pin) : null;
        game?.logger?.exception('player_update_avatar', err, { socketId: socket.id, userUuid: me?.userUuid });
      }
    });

    // Player requests document / state sync if missing data or reconnected
    socket.on('player_request_sync', (data = {}) => {
      let me = null;
      try {
        me = resolvePlayer(socket, data);
        if (!me) {
          const pin = data.pin;
          const game = pin ? gameManager.getGameByPinOrId(pin) : null;
          game?.logger?.unusualRequest('SYNC_WITHOUT_SESSION', socket.id, { data });
          socket.emit('sync_error', { error: 'Please join the game first' });
          return;
        }
        const game = gameManager.getGameByPinOrId(me.pin);
        if (!game) {
          socket.emit('sync_error', { error: 'Game not found or has ended' });
          return;
        }
        game.logger?.unusualRequest('PLAYER_REQUEST_SYNC', socket.id, {
          userUuid: me.userUuid,
          nickname: me.nickname,
          gameState: game.state,
          currentQuestionIndex: game.currentQuestionIndex,
        });
        for (const [event, payload] of gameManager.getPlayerResumeEvents(game, me.userUuid)) {
          socket.emit(event, payload);
        }
      } catch (err) {
        console.error('Error handling player_request_sync:', err);
        const game = me?.pin ? gameManager.getGameByPinOrId(me.pin) : null;
        game?.logger?.exception('player_request_sync', err, { socketId: socket.id, userUuid: me?.userUuid });
        socket.emit('sync_error', { error: 'Failed to sync game state' });
      }
    });

    // Disconnect
    socket.on('disconnect', () => {
      try {
        gameManager.handleDisconnect(socket.id);
      } catch (err) {
        console.error('Error handling socket disconnect:', err);
      }
    });
  });
}
