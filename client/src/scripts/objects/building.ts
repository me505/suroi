import { Container, Graphics } from "pixi.js";
import { ObjectCategory, ZIndexes } from "../../../../common/src/constants";
import { type BuildingDefinition } from "../../../../common/src/definitions/buildings";
import { type Orientation } from "../../../../common/src/typings";
import { CircleHitbox, RectangleHitbox, type Hitbox, HitboxGroup } from "../../../../common/src/utils/hitbox";
import { circleCircleIntersection, rectCircleIntersection, polarToVector } from "../../../../common/src/utils/math";
import { type ObjectsNetData } from "../../../../common/src/utils/objectsSerializations";
import { randomFloat, randomRotation } from "../../../../common/src/utils/random";
import type { Game } from "../game";
import { GameObject } from "./gameObject";

import { HITBOX_COLORS, HITBOX_DEBUG_MODE, PIXI_SCALE } from "../utils/constants";
import { orientationToRotation } from "../utils/misc";
import { SuroiSprite, drawHitbox, toPixiCoords } from "../utils/pixi";
import { EaseFunctions, Tween } from "../utils/tween";
import { type Vector, v, vAdd, vMul, vRotate } from "../../../../common/src/utils/vector";
import { ObstacleSpecialRoles } from "../../../../common/src/utils/objectDefinitions";
import type { GameSound } from "../utils/soundManager";

export class Building extends GameObject<ObjectCategory.Building> {
    override readonly type = ObjectCategory.Building;

    readonly ceilingContainer: Container;

    definition!: BuildingDefinition;

    ceilingHitbox?: Hitbox;
    ceilingTween?: Tween<Container>;

    orientation!: Orientation;

    ceilingVisible = false;

    sound?: GameSound;

    constructor(game: Game, id: number, data: Required<ObjectsNetData[ObjectCategory.Building]>) {
        super(game, id);

        this.container.zIndex = ZIndexes.BuildingsFloor;

        this.ceilingContainer = new Container();
        this.game.camera.addObject(this.ceilingContainer);

        this.updateFromData(data, true);
    }

    toggleCeiling(): void {
        if (this.ceilingHitbox === undefined || this.dead) return;
        const player = this.game.activePlayer;
        if (player === undefined) return;

        let visible = false;

        if (this.ceilingHitbox.collidesWith(player.hitbox)) {
            visible = true;
        } else {
            const visionSize = 14;

            const playerHitbox = new CircleHitbox(visionSize, player.position);

            const hitboxes = this.ceilingHitbox instanceof HitboxGroup ? this.ceilingHitbox.hitboxes : [this.ceilingHitbox];

            let graphics: Graphics | undefined;
            if (HITBOX_DEBUG_MODE) {
                graphics = new Graphics();
                graphics.zIndex = 100;
                this.game.camera.addObject(graphics);
            }

            for (const hitbox of hitboxes) {
                // find the direction to cast rays
                let direction: Vector | null = null;

                if (hitbox instanceof CircleHitbox) {
                    const intersection = circleCircleIntersection(
                        hitbox.position,
                        hitbox.radius,
                        playerHitbox.position,
                        playerHitbox.radius);

                    direction = intersection?.dir ?? null;
                } else if (hitbox instanceof RectangleHitbox) {
                    const intersection = rectCircleIntersection(hitbox.min,
                        hitbox.max,
                        playerHitbox.position,
                        playerHitbox.radius);

                    direction = intersection?.dir ?? null;
                }

                if (direction) {
                    if (HITBOX_DEBUG_MODE) {
                        graphics?.lineStyle({
                            color: 0xff0000,
                            width: 0.1
                        });

                        graphics?.beginFill();
                        graphics?.scale.set(PIXI_SCALE);

                        this.addTimeout(() => {
                            graphics?.destroy();
                        }, 30);
                    }

                    const angle = Math.atan2(direction.y, direction.x);

                    let collided = false;

                    const halfPi = Math.PI / 2;
                    for (let i = angle - halfPi; i < angle + halfPi; i += 0.1) {
                        collided = false;
                        const vec = vAdd(player.position, vMul(v(Math.cos(i), Math.sin(i)), visionSize));
                        const end = this.ceilingHitbox.intersectsLine(player.position, vec)?.point;
                        if (!end) {
                            collided = true;
                            continue;
                        }
                        graphics?.moveTo(player.position.x, player.position.y);
                        graphics?.lineTo(end.x, end.y);
                        graphics?.endFill();

                        for (const obstacle of this.game.objects.getCategory(ObjectCategory.Obstacle)) {
                            if (obstacle.damageable &&
                                !obstacle.dead &&
                                obstacle.definition.role !== ObstacleSpecialRoles.Window &&
                                obstacle.hitbox?.intersectsLine(player.position, end)) {
                                collided = true;
                                break;
                            }
                        }
                        if (!collided) break;
                    }
                    visible = !collided;
                } else {
                    visible = false;
                }
                if (visible) break;
            }
        }

        if (this.ceilingVisible === visible) return;

        this.ceilingVisible = visible;

        this.ceilingTween?.kill();

        this.ceilingTween = new Tween(
            this.game,
            {
                target: this.ceilingContainer,
                to: { alpha: visible ? 0 : 1 },
                duration: visible ? 150 : 300,
                ease: EaseFunctions.sineOut
            }
        );
    }

    override updateFromData(data: ObjectsNetData[ObjectCategory.Building], isNew = false): void {
        if (data.full) {
            const full = data.full;
            this.definition = full.definition;
            this.position = full.position;

            for (const image of this.definition.floorImages ?? []) {
                const sprite = new SuroiSprite(image.key);
                sprite.setVPos(toPixiCoords(image.position));
                if (image.tint !== undefined) sprite.setTint(image.tint);
                if (image.rotation) sprite.setRotation(image.rotation);
                this.container.addChild(sprite);
            }

            const pos = toPixiCoords(this.position);
            this.container.position.copyFrom(pos);
            this.ceilingContainer.position.copyFrom(pos);
            this.ceilingContainer.zIndex = this.definition.ceilingZIndex ?? ZIndexes.BuildingsCeiling;

            this.orientation = full.rotation;
            this.rotation = orientationToRotation(this.orientation);
            this.container.rotation = this.rotation;
            this.ceilingContainer.rotation = this.rotation;

            this.ceilingHitbox = (this.definition.scopeHitbox ?? this.definition.ceilingHitbox)?.transform(this.position, 1, this.orientation);

            if (this.definition.sounds) {
                const sounds = this.definition.sounds;

                const soundOptions = {
                    position: vAdd(vRotate(sounds?.position ?? v(0, 0), this.rotation), this.position),
                    fallOff: sounds.fallOff,
                    maxRange: sounds.maxRange,
                    dynamic: true,
                    loop: true
                };

                if (sounds.normal &&
                    !full.puzzleSolved &&
                    this.sound?.name !== sounds.normal) {
                    this.sound?.stop();
                    this.sound = this.game.soundManager.play(sounds.normal, soundOptions);
                }

                if (sounds.solved &&
                    full.puzzleSolved &&
                    this.sound?.name !== sounds.solved) {
                    this.sound?.stop();
                    this.sound = this.game.soundManager.play(sounds.solved, soundOptions);
                }
            }
        }

        const definition = this.definition;

        if (definition === undefined) {
            console.warn("Building partially updated before being fully updated");
        }

        if (data.dead) {
            if (!this.dead && !isNew) {
                this.game.particleManager.spawnParticles(10, () => ({
                    frames: `${this.definition.idString}_particle`,
                    position: this.ceilingHitbox?.randomPoint() ?? { x: 0, y: 0 },
                    zIndex: 10,
                    lifetime: 2000,
                    rotation: {
                        start: randomRotation(),
                        end: randomRotation()
                    },
                    alpha: {
                        start: 1,
                        end: 0,
                        ease: EaseFunctions.sextIn
                    },
                    scale: { start: 1, end: 0.2 },
                    speed: polarToVector(randomRotation(), randomFloat(1, 2))
                }));

                this.playSound(
                    "ceiling_collapse",
                    {
                        fallOff: 0.5,
                        maxRange: 96
                    }
                );
            }
            this.ceilingTween?.kill();
            this.ceilingContainer.zIndex = ZIndexes.DeadObstacles;
            this.ceilingContainer.alpha = 1;

            this.ceilingContainer.addChild(new SuroiSprite(`${definition.idString}_residue`));
        }
        this.dead = data.dead;

        this.ceilingContainer.removeChildren();
        for (const image of definition.ceilingImages ?? []) {
            let key = image.key;
            if (this.dead && image.residue) key = image.residue;
            const sprite = new SuroiSprite(key);
            sprite.setVPos(toPixiCoords(image.position));
            if (image.tint !== undefined) sprite.setTint(image.tint);
            this.ceilingContainer.addChild(sprite);
        }

        if (HITBOX_DEBUG_MODE) {
            this.debugGraphics.clear();

            if (this.ceilingHitbox !== undefined) drawHitbox(this.ceilingHitbox, HITBOX_COLORS.buildingScopeCeiling, this.debugGraphics);

            drawHitbox(
                definition.spawnHitbox.transform(this.position, 1, this.orientation),
                HITBOX_COLORS.spawnHitbox,
                this.debugGraphics
            );

            if (definition.scopeHitbox !== undefined) {
                drawHitbox(
                    definition.scopeHitbox.transform(this.position, 1, this.orientation),
                    HITBOX_COLORS.buildingZoomCeiling,
                    this.debugGraphics
                );
            }

            drawHitbox(
                definition.spawnHitbox.transform(this.position, 1, this.orientation),
                HITBOX_COLORS.spawnHitbox,
                this.debugGraphics
            );

            if (definition.scopeHitbox) {
                drawHitbox(
                    definition.scopeHitbox.transform(this.position, 1, this.orientation),
                    HITBOX_COLORS.buildingZoomCeiling,
                    this.debugGraphics
                );
            }
        }
    }

    destroy(): void {
        super.destroy();
        this.ceilingTween?.kill();
        this.ceilingContainer.destroy();
        this.sound?.stop();
    }
}
