import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = window.SUPABASE_URL || 'https://dvewchcpxciaqffvaocg.supabase.co';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2ZXdjaGNweGNpYXFmZnZhb2NnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjI5NDksImV4cCI6MjEwMDczODk0OX0.zh0AH0gjerXBWF8e_sH71gB7BfjtPmjQ24yfqXlk6nc';

const LOBBY_TTL_MS = 15_000;
const LOBBY_REFRESH_MS = 3_000;
const LOBBY_HEARTBEAT_MS = 5_000;
const ROOM_CONNECT_TIMEOUT_MS = 12_000;
const STATE_SEND_INTERVAL_MS = 50;

const SHIP_COLORS = [
    '#00ffff', '#ff00ff', '#ffff00', '#ff0000',
    '#00ff00', '#0000ff', '#ff8800', '#8800ff',
];

export class NetworkManager {
    constructor(game) {
        this.game = game;
        this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        this.myId = globalThis.crypto?.randomUUID?.()
            || Math.random().toString(36).slice(2);

        this.channel = null;
        this.roomName = null;
        this.isHost = false;
        this.isConnected = false;

        this.activeLobbies = {};
        this.lobbyInitPromise = null;
        this.lobbyRefreshInterval = null;
        this.lobbyHeartbeatInterval = null;
        this.lastStateSentAt = 0;
        this.lobbyStatusUpdateTimer = null;
        // The host reserves colors while join requests are in flight. Presence
        // alone cannot do this because simultaneous joiners initially see the
        // same roster.
        this.reservedShipColors = new Map();
        this.pendingColorAssignment = null;

        // Browsers do not wait for async work while closing. Start the Realtime
        // leave immediately so peers receive a Presence sync instead of waiting
        // for the server's disconnect timeout.
        this.handlePageExit = () => this.leave({ immediate: true });
        window.addEventListener('pagehide', this.handlePageExit);
        window.addEventListener('beforeunload', this.handlePageExit);
    }

    getAvailableShipColor(presenceState) {
        const usedColors = new Set(
            Object.values(presenceState || {})
                .flat()
                .map((presence) => presence.color)
                .filter((color) => SHIP_COLORS.includes(color)),
        );

        return SHIP_COLORS.find((color) => !usedColors.has(color))
            || SHIP_COLORS[0];
    }

    getHostAssignedColor(presenceState) {
        const usedColors = new Set([
            ...Object.values(presenceState || {}).flat().map((presence) => presence.color),
            ...[...this.reservedShipColors.values()].map((reservation) => reservation.color),
        ]);

        return SHIP_COLORS.find((color) => !usedColors.has(color))
            || SHIP_COLORS[this.reservedShipColors.size % SHIP_COLORS.length];
    }

    async requestShipColor(roomChannel) {
        if (this.isHost) return SHIP_COLORS[0];

        return new Promise((resolve) => {
            const timeoutId = setTimeout(() => {
                this.pendingColorAssignment = null;
                // A host normally answers immediately. This fallback still
                // allows a match to start if its browser has just disconnected.
                resolve(this.getAvailableShipColor(roomChannel.presenceState()));
            }, 5_000);

            this.pendingColorAssignment = (color) => {
                clearTimeout(timeoutId);
                this.pendingColorAssignment = null;
                resolve(color);
            };

            roomChannel.send({
                type: 'broadcast',
                event: 'request-ship-color',
                payload: { playerId: this.myId },
            });
        });
    }

    setStatus(message) {
        const statusEl = document.getElementById('status-text');
        if (statusEl) statusEl.textContent = message;
    }

    async initLobby() {
        if (this.lobbyInitPromise) return this.lobbyInitPromise;

        this.lobbyInitPromise = (async () => {
            await this.refreshLobbyList();

            if (!this.lobbyRefreshInterval) {
                this.lobbyRefreshInterval = setInterval(() => {
                    this.refreshLobbyList().catch(console.error);
                }, LOBBY_REFRESH_MS);
            }
        })();

        try {
            await this.lobbyInitPromise;
        } finally {
            this.lobbyInitPromise = null;
        }
    }

    async refreshLobbyList() {
        const cutoff = new Date(Date.now() - LOBBY_TTL_MS).toISOString();

        const { data, error } = await this.supabase
            .from('game_rooms')
            .select('room_id, host_name, trans_kills, player_count, last_seen')
            .gte('last_seen', cutoff)
            .order('last_seen', { ascending: false });

        if (error) throw error;

        this.activeLobbies = Object.fromEntries(
            (data || []).map((room) => [
                room.room_id,
                {
                    roomId: room.room_id,
                    hostName: room.host_name,
                    transKills: room.trans_kills,
                    playerCount: room.player_count,
                    lastSeen: new Date(room.last_seen).getTime(),
                },
            ]),
        );

        this.game.updateLobbyListUI(this.activeLobbies);
    }

    async host(roomName, transKills) {
        this.roomName = roomName;
        this.isHost = true;

        await this.initLobby();
        await this.joinRealtimeRoom();
        await this.publishLobbyStatus(transKills);
        this.startLobbyHeartbeat();
    }

    async joinRoom(roomName) {
        this.roomName = roomName;
        this.isHost = false;
        await this.joinRealtimeRoom();
    }

    async joinRealtimeRoom() {
        this.setStatus(`Connecting to ${this.roomName}...`);

        if (this.channel) {
            await this.supabase.removeChannel(this.channel);
        }

        const roomChannel = this.supabase.channel(`arena:${this.roomName}`, {
            config: {
                presence: { key: this.myId },
                broadcast: { self: false },
            },
        });

        this.channel = roomChannel;

        try {
            await new Promise((resolve, reject) => {
                let settled = false;
                let presenceSynced = false;
                let resolvePresenceSync;
                const presenceSyncPromise = new Promise((resolveSync) => {
                    resolvePresenceSync = resolveSync;
                });

                const finish = (callback, value) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeoutId);
                    callback(value);
                };

                const timeoutId = setTimeout(() => {
                    const error = new Error(`Timed out joining ${this.roomName}.`);
                    this.isConnected = false;
                    this.setStatus('Online: Connection timed out');
                    finish(reject, error);
                }, ROOM_CONNECT_TIMEOUT_MS);

                    roomChannel
                        .on('presence', { event: 'sync' }, () => {
                            this.handlePresence(roomChannel.presenceState());
                            this.scheduleLobbyStatusUpdate();
                            if (!presenceSynced) {
                                presenceSynced = true;
                                resolvePresenceSync();
                            }
                        })
                        .on('presence', { event: 'join' }, () => {
                            // Wait briefly for Presence to finish updating, then host writes the
                            // correct player count to the database-backed lobby list.
                            this.scheduleLobbyStatusUpdate();
                        })
                        .on('presence', { event: 'leave' }, () => {
                            this.scheduleLobbyStatusUpdate();
                        })
                        .on('broadcast', { event: 'lobby-roster-changed' }, () => {
                            this.scheduleLobbyStatusUpdate();
                        })
                        .on('broadcast', { event: 'player-state' }, ({ payload }) => {
                        this.handleRemoteState(payload);
                    })
                    .on('broadcast', { event: 'fire' }, ({ payload }) => {
                        this.game.spawnRemoteProjectiles(payload);
                    })
                    .on('broadcast', { event: 'request-ship-color' }, ({ payload }) => {
                        if (!this.isHost || !payload?.playerId) return;

                        const color = this.getHostAssignedColor(roomChannel.presenceState());
                        this.reservedShipColors.set(payload.playerId, {
                            color,
                            expiresAt: Date.now() + 12_000,
                        });
                        roomChannel.send({
                            type: 'broadcast',
                            event: 'ship-color-assigned',
                            payload: { playerId: payload.playerId, color },
                        });
                    })
                    .on('broadcast', { event: 'ship-color-assigned' }, ({ payload }) => {
                        if (payload?.playerId === this.myId && this.pendingColorAssignment) {
                            this.pendingColorAssignment(payload.color);
                        }
                    })
                    .subscribe(async (status, error) => {
                        console.log(`Realtime status for ${this.roomName}:`, status, error || '');

                            if (status === 'SUBSCRIBED') {
                                try {
                                    // Presence sync is separate from SUBSCRIBED. Without this
                                    // wait, simultaneous/new arrivals can all see an empty roster
                                    // and choose cyan.
                                    await Promise.race([
                                        presenceSyncPromise,
                                        new Promise((resolveSync) => setTimeout(resolveSync, 750)),
                                    ]);

                                    const player = this.game.players[0];

                                    // The host is cyan. Every other browser asks the host to
                                    // reserve a color before it joins Presence, preventing races.
                                    player.color = await this.requestShipColor(roomChannel);

                                const trackStatus = await roomChannel.track({
                                    id: this.myId,
                                    name: player.name,
                                    x: player.x,
                                    y: player.y,
                                    vx: 0,
                                    vy: 0,
                                    rotation: 0,
                                    isDead: false,
                                    color: player.color,
                                    lastUpdate: Date.now(),
                                });

                                if (trackStatus !== 'ok') {
                                    throw new Error(`Presence tracking failed: ${trackStatus}`);
                                }

                                roomChannel.send({
                                    type: 'broadcast',
                                    event: 'lobby-roster-changed',
                                    payload: { playerId: this.myId },
                                }).catch((error) => {
                                    console.warn('Could not notify host about roster change:', error);
                                });

                                this.isConnected = true;
                                this.setStatus(`Online: Connected to ${this.roomName}`);
                                finish(resolve);
                            } catch (trackError) {
                                this.isConnected = false;
                                this.setStatus('Online: Connection failed');
                                finish(reject, trackError);
                            }

                            return;
                        }

                        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                            this.isConnected = false;
                            this.setStatus('Online: Connection failed');
                            finish(reject, error || new Error(`Realtime error: ${status}`));
                        }
                    });
            });
        } catch (error) {
            if (this.channel) {
                await this.supabase.removeChannel(this.channel);
                this.channel = null;
            }
            throw error;
        }
    }

    async publishLobbyStatus(transKills = this.game.transformationKills) {
        if (!this.isHost || !this.channel || !this.roomName) return;

        const player = this.game.players[0];
        const presence = this.channel.presenceState() || {};

        // Each Presence key represents one connected browser/player.
        const playerCount = Math.max(1, Object.keys(presence).length);

        const { error } = await this.supabase
            .from('game_rooms')
            .upsert({
                room_id: this.roomName,
                host_id: this.myId,
                host_name: player?.name || 'PILOT',
                trans_kills: transKills,
                player_count: playerCount,
                last_seen: new Date().toISOString(),
            }, {
                onConflict: 'room_id',
            });

        if (error) throw error;
    }

    scheduleLobbyStatusUpdate() {
        if (!this.isHost) return;

        if (this.lobbyStatusUpdateTimer) {
            clearTimeout(this.lobbyStatusUpdateTimer);
        }

        this.lobbyStatusUpdateTimer = setTimeout(() => {
            this.lobbyStatusUpdateTimer = null;

            this.publishLobbyStatus().catch((error) => {
                console.error('Lobby update failed:', error);
            });
        }, 250);
    }

    startLobbyHeartbeat() {
        if (this.lobbyHeartbeatInterval) {
            clearInterval(this.lobbyHeartbeatInterval);
        }

        this.lobbyHeartbeatInterval = setInterval(() => {
            this.publishLobbyStatus().catch(console.error);
        }, LOBBY_HEARTBEAT_MS);
    }

    handlePresence(presenceState) {
        const peers = {};

        for (const [peerId, presences] of Object.entries(presenceState || {})) {
            if (presences[0]) peers[peerId] = presences[0];
        }

        for (const [peerId, data] of Object.entries(peers)) {
            if (peerId === this.myId) continue;

            let remotePlayer = this.game.players.find(
                (player) => player.networkId === peerId,
            );

            if (!remotePlayer) {
                remotePlayer = this.game.spawnRemotePlayer(
                    data.x || 0,
                    data.y || 0,
                    peerId,
                    data.color,
                );
            }

            Object.assign(remotePlayer, {
                name: data.name || 'PILOT',
                x: data.x,
                y: data.y,
                vx: data.vx,
                vy: data.vy,
                rotation: data.rotation,
                isDead: data.isDead,
                color: data.color || remotePlayer.color,
                lastNetworkUpdate: data.lastUpdate,
            });
        }

        if (this.isHost) {
            const activePeerIds = new Set(Object.keys(peers));
            for (const [peerId, reservation] of this.reservedShipColors) {
                // Once the player has tracked Presence, its color is protected
                // by that roster. Expired requests never joined and can be freed.
                if (activePeerIds.has(peerId) || reservation.expiresAt <= Date.now()) {
                    this.reservedShipColors.delete(peerId);
                }
            }
        }

        this.game.players = this.game.players.filter((player) =>
            player.id === 1
            || player.id === 2
            || !player.networkId
            || Boolean(peers[player.networkId]),
        );

        if (this.isHost) {
            this.publishLobbyStatus().catch(console.error);
        }
    }

    sendState() {
        if (!this.isConnected || !this.channel || !this.game.players[0]) return;

        const now = performance.now();
        if (now - this.lastStateSentAt < STATE_SEND_INTERVAL_MS) return;
        this.lastStateSentAt = now;

        const player = this.game.players[0];

        this.channel.send({
            type: 'broadcast',
            event: 'player-state',
            payload: {
                ownerId: this.myId,
                name: (player.name || 'PILOT').toUpperCase(),
                x: player.x,
                y: player.y,
                vx: player.vx,
                vy: player.vy,
                rotation: player.rotation,
                isDead: player.isDead,
                color: player.color,
                lastUpdate: Date.now(),
            },
        });
    }

    handleRemoteState(data) {
        if (!data?.ownerId || data.ownerId === this.myId) return;

        let remotePlayer = this.game.players.find(
            (player) => player.networkId === data.ownerId,
        );

        if (!remotePlayer) {
            remotePlayer = this.game.spawnRemotePlayer(
                data.x || 0,
                data.y || 0,
                data.ownerId,
                data.color,
            );
        }

        Object.assign(remotePlayer, {
            name: data.name || 'PILOT',
            x: data.x,
            y: data.y,
            vx: data.vx,
            vy: data.vy,
            rotation: data.rotation,
            isDead: data.isDead,
            color: data.color || remotePlayer.color,
            lastNetworkUpdate: data.lastUpdate,
        });
    }

    broadcastFire(projectiles) {
        if (!this.isConnected || !this.channel || !projectiles?.length) return;

        const shots = projectiles.map((projectile) => ({
            x: projectile.x,
            y: projectile.y,
            vx: projectile.vx,
            vy: projectile.vy,
            rotation: projectile.rotation,
            color: projectile.color,
            radius: projectile.radius,
            lifeSpan: projectile.lifeSpan,
            canWrap: projectile.canWrap,
            isLaser: projectile.isLaser,
            isGhost: projectile.isGhost,
            isMissile: projectile.isMissile,
            isDecoy: projectile.isDecoy,
            isTentacle: projectile.isTentacle,
            isSkinnyMissile: projectile.isSkinnyMissile,
            isOrbital: projectile.isOrbital,
            orbitalAngle: projectile.orbitalAngle,
            orbitalDistance: projectile.orbitalDistance,
            aoeRadius: projectile.aoeRadius,
            tentacleLength: projectile.tentacleLength,
            maxTentacleLength: projectile.maxTentacleLength,
            tentaclePhase: projectile.tentaclePhase,
        }));

        this.channel.send({
            type: 'broadcast',
            event: 'fire',
            payload: {
                ownerId: this.myId,
                ownerColor: this.game.players[0]?.color,
                firedAt: Date.now(),
                shots,
            },
        });
    }

    async hideHostedLobby(roomName, hostId) {
        if (!roomName || !hostId) return;

        // The lobby list already filters by last_seen, so aging this row out is
        // immediate and works with the existing INSERT/UPDATE-only RLS policy.
        const { error } = await this.supabase
            .from('game_rooms')
            .update({ last_seen: new Date(0).toISOString() })
            .eq('room_id', roomName)
            .eq('host_id', hostId);

        if (error) console.warn('Could not hide closed lobby:', error);
    }

    async leave({ immediate = false } = {}) {
        const roomName = this.roomName;
        const wasHost = this.isHost;
        const channel = this.channel;

        this.isConnected = false;
        this.isHost = false;
        this.channel = null;
        this.roomName = null;
        this.pendingColorAssignment = null;
        this.reservedShipColors.clear();

        if (this.lobbyHeartbeatInterval) {
            clearInterval(this.lobbyHeartbeatInterval);
            this.lobbyHeartbeatInterval = null;
        }

        if (channel) {
            // untrack sends a Presence leave; removeChannel then closes its socket
            // subscription. Do both because either can be skipped during page exit.
            const leavePresence = channel.untrack().catch(() => {});
            const removeChannel = this.supabase.removeChannel(channel).catch(() => {});

            if (!immediate) {
                await Promise.all([leavePresence, removeChannel]);
            }
        }

        if (wasHost) {
            const hideLobby = this.hideHostedLobby(roomName, this.myId);
            if (!immediate) await hideLobby;
        }
    }

    listenForEvents() {
        // Listeners are registered in joinRealtimeRoom().
    }
}
