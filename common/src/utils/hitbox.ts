import { type Orientation } from "../typings";
import { addAdjust, circleCircleIntersection, circleCollision, type CollisionRecord, distanceSquared, distanceToCircle, distanceToRectangle, type IntersectionResponse, lineIntersectsCircle, lineIntersectsRect, rectangleCollision, rectangleDistanceToRectangle, rectCircleIntersection, rectRectCollision, transformRectangle, distance, lineIntersectsRect2, rectRectIntersection } from "./math";
import { pickRandomInArray, randomFloat, randomPointInsideCircle } from "./random";
import { v, vAdd, vClone, type Vector, vMul, vSub } from "./vector";

export enum HitboxType {
    Circle,
    Rect,
    Group,
    Polygon
}

export interface HitboxJsonMapping {
    [HitboxType.Circle]: {
        type: HitboxType.Circle
        radius: number
        position: Vector
    }
    [HitboxType.Rect]: {
        type: HitboxType.Rect
        min: Vector
        max: Vector
    }
    [HitboxType.Group]: {
        type: HitboxType.Group
        hitboxes: Array<HitboxJsonMapping[HitboxType.Circle | HitboxType.Rect]>
    }
    [HitboxType.Polygon]: {
        type: HitboxType.Polygon
        points: Vector[]
    }
}

export type HitboxJson = HitboxJsonMapping[HitboxType];

export interface HitboxMapping {
    [HitboxType.Circle]: CircleHitbox
    [HitboxType.Rect]: RectangleHitbox
    [HitboxType.Group]: HitboxGroup
    [HitboxType.Polygon]: PolygonHitbox
}

export type Hitbox = HitboxMapping[HitboxType];

export abstract class BaseHitbox<T extends HitboxType = HitboxType> {
    abstract type: HitboxType;

    abstract toJSON(): HitboxJsonMapping[T];

    static fromJSON(data: HitboxJson): Hitbox {
        switch (data.type) {
            case HitboxType.Circle:
                return new CircleHitbox(data.radius, data.position);
            case HitboxType.Rect:
                return new RectangleHitbox(data.min, data.max);
            case HitboxType.Group:
                return new HitboxGroup(
                    ...data.hitboxes.map(d => BaseHitbox.fromJSON(d) as CircleHitbox | RectangleHitbox)
                );
            case HitboxType.Polygon:
                return new PolygonHitbox(data.points);
        }
    }

    /**
     * Checks if this {@link Hitbox} collides with another one
     * @param that The other {@link Hitbox}
     * @return `true` if both {@link Hitbox}es collide
     */
    abstract collidesWith(that: Hitbox): boolean;
    /**
     * Resolve collision between {@link Hitbox}es.
     * @param that The other {@link Hitbox}
     */
    abstract resolveCollision(that: Hitbox): void;
    /**
     * Get the distance from this {@link Hitbox} from another {@link Hitbox}.
     * @param that The other {@link Hitbox}
     * @return A {@link CollisionRecord} with the distance and if both {@link Hitbox}es collide
     */
    abstract distanceTo(that: Hitbox): CollisionRecord;
    /**
     * Clone this {@link Hitbox}.
     * @return a new {@link Hitbox} cloned from this one
     */
    abstract clone(): Hitbox;
    /**
     * Transform this {@link Hitbox} and returns a new {@link Hitbox}.
     * NOTE: This doesn't change the initial {@link Hitbox}
     * @param position The position to transform the {@link Hitbox} by
     * @param scale The scale to transform the {@link Hitbox}
     * @param orientation The orientation to transform the {@link Hitbox}
     * @return A new {@link Hitbox} transformed by the parameters
     */
    abstract transform(position: Vector, scale?: number, orientation?: Orientation): Hitbox;
    /**
     * Scale this {@link Hitbox}.
     * NOTE: This does change the initial {@link Hitbox}
     * @param scale The scale
     */
    abstract scale(scale: number): void;
    /**
     * Check if a line intersects with this {@link Hitbox}.
     * @param a the start point of the line
     * @param b the end point of the line
     * @return An intersection response containing the intersection position and normal
     */
    abstract intersectsLine(a: Vector, b: Vector): IntersectionResponse;
    /**
     * Get a random position inside this {@link Hitbox}.
     * @return A Vector of a random position inside this {@link Hitbox}
     */
    abstract randomPoint(): Vector;

    abstract toRectangle(): RectangleHitbox;

    abstract isPointInside(point: Vector): boolean;

    abstract getCenter(): Vector;

    protected throwUnknownSubclassError(that: Hitbox): never {
        throw new Error(`Hitbox type ${HitboxType[this.type]} doesn't support this operation with hitbox type ${HitboxType[that.type]}`);
    }
}

export class CircleHitbox extends BaseHitbox<HitboxType.Circle> {
    override readonly type = HitboxType.Circle;
    position: Vector;
    radius: number;

    constructor(radius: number, position?: Vector) {
        super();

        this.position = position ?? v(0, 0);
        this.radius = radius;
    }

    override toJSON(): HitboxJsonMapping[HitboxType.Circle] {
        return {
            type: this.type,
            radius: this.radius,
            position: vClone(this.position)
        };
    }

    override collidesWith(that: Hitbox): boolean {
        switch (that.type) {
            case HitboxType.Circle:
                return circleCollision(that.position, that.radius, this.position, this.radius);
            case HitboxType.Rect:
                return rectangleCollision(that.min, that.max, this.position, this.radius);
            case HitboxType.Group:
                return that.collidesWith(this);
            case HitboxType.Polygon:
                // todo: proper circle to polygon detection
                return that.collidesWith(this.toRectangle());
        }
    }

    override resolveCollision(that: Hitbox): void {
        switch (that.type) {
            case HitboxType.Circle: {
                const collision = circleCircleIntersection(this.position, this.radius, that.position, that.radius);
                if (collision) {
                    this.position = vSub(this.position, vMul(collision.dir, collision.pen));
                }
            }
                break;
            case HitboxType.Rect: {
                const collision = rectCircleIntersection(that.min, that.max, this.position, this.radius);
                if (collision) {
                    this.position = vSub(this.position, vMul(collision.dir, collision.pen));
                }
                break;
            }
            case HitboxType.Group: {
                for (const hitbox of that.hitboxes) {
                    if (this.collidesWith(hitbox)) this.resolveCollision(hitbox);
                }
                break;
            }
            default:
                this.throwUnknownSubclassError(that);
        }
    }

    override distanceTo(that: Hitbox): CollisionRecord {
        switch (that.type) {
            case HitboxType.Circle:
                return distanceToCircle(that.position, that.radius, this.position, this.radius);
            case HitboxType.Rect:
                return distanceToRectangle(that.min, that.max, this.position, this.radius);
            default:
                this.throwUnknownSubclassError(that);
        }
    }

    override clone(): CircleHitbox {
        return new CircleHitbox(this.radius, vClone(this.position));
    }

    override transform(position: Vector, scale = 1, orientation = 0 as Orientation): CircleHitbox {
        return new CircleHitbox(this.radius * scale, addAdjust(position, this.position, orientation));
    }

    override scale(scale: number): void {
        this.radius *= scale;
    }

    override intersectsLine(a: Vector, b: Vector): IntersectionResponse {
        return lineIntersectsCircle(a, b, this.position, this.radius);
    }

    override randomPoint(): Vector {
        return randomPointInsideCircle(this.position, this.radius);
    }

    override toRectangle(): RectangleHitbox {
        return new RectangleHitbox(v(this.position.x - this.radius, this.position.y - this.radius), v(this.position.x + this.radius, this.position.y + this.radius));
    }

    override isPointInside(point: Vector): boolean {
        return distance(point, this.position) < this.radius;
    }

    override getCenter(): Vector {
        return this.position;
    }
}

export class RectangleHitbox extends BaseHitbox<HitboxType.Rect> {
    override readonly type = HitboxType.Rect;
    min: Vector;
    max: Vector;

    constructor(min: Vector, max: Vector) {
        super();

        this.min = min;
        this.max = max;
    }

    toJSON(): HitboxJsonMapping[HitboxType.Rect] {
        return {
            type: this.type,
            min: vClone(this.min),
            max: vClone(this.max)
        };
    }

    static fromLine(a: Vector, b: Vector): RectangleHitbox {
        return new RectangleHitbox(
            v(
                Math.min(a.x, b.x),
                Math.min(a.y, b.y)
            ),
            v(
                Math.max(a.x, b.x),
                Math.max(a.y, b.y)
            )
        );
    }

    static fromRect(width: number, height: number, pos = v(0, 0)): RectangleHitbox {
        const size = v(width / 2, height / 2);

        return new RectangleHitbox(
            vSub(pos, size),
            vAdd(pos, size)
        );
    }

    override collidesWith(that: Hitbox): boolean {
        switch (that.type) {
            case HitboxType.Circle:
                return rectangleCollision(this.min, this.max, that.position, that.radius);
            case HitboxType.Rect:
                return rectRectCollision(that.min, that.max, this.min, this.max);
            case HitboxType.Group:
            case HitboxType.Polygon:
                return that.collidesWith(this);
        }
    }

    override resolveCollision(that: Hitbox): void {
        switch (that.type) {
            case HitboxType.Circle: {
                const collision = rectCircleIntersection(this.min, this.max, that.position, that.radius);
                if (collision) {
                    const rect = this.transform(vMul(collision.dir, collision.pen));
                    this.min = rect.min;
                    this.max = rect.max;
                }
                break;
            }
            case HitboxType.Rect: {
                const collision = rectRectIntersection(this.min, this.max, that.min, that.max);
                if (collision) {
                    const rect = this.transform(vMul(collision.dir, collision.pen));
                    this.min = rect.min;
                    this.max = rect.max;
                }
                break;
            }
            case HitboxType.Group: {
                for (const hitbox of that.hitboxes) {
                    if (this.collidesWith(hitbox)) this.resolveCollision(hitbox);
                }
                break;
            }
            default:
                this.throwUnknownSubclassError(that);
        }
    }

    override distanceTo(that: Hitbox): CollisionRecord {
        switch (that.type) {
            case HitboxType.Circle:
                return distanceToRectangle(this.min, this.max, that.position, that.radius);
            case HitboxType.Rect:
                return rectangleDistanceToRectangle(that.min, that.max, this.min, this.max);
        }
        this.throwUnknownSubclassError(that);
    }

    override clone(): RectangleHitbox {
        return new RectangleHitbox(vClone(this.min), vClone(this.max));
    }

    override transform(position: Vector, scale = 1, orientation = 0 as Orientation): RectangleHitbox {
        const rect = transformRectangle(position, this.min, this.max, scale, orientation);

        return new RectangleHitbox(rect.min, rect.max);
    }

    override scale(scale: number): void {
        const centerX = (this.min.x + this.max.x) / 2;
        const centerY = (this.min.y + this.max.y) / 2;
        this.min = v((this.min.x - centerX) * scale + centerX, (this.min.y - centerY) * scale + centerY);
        this.max = v((this.max.x - centerX) * scale + centerX, (this.max.y - centerY) * scale + centerY);
    }

    override intersectsLine(a: Vector, b: Vector): IntersectionResponse {
        return lineIntersectsRect(a, b, this.min, this.max);
    }

    override randomPoint(): Vector {
        return {
            x: randomFloat(this.min.x, this.max.x),
            y: randomFloat(this.min.y, this.max.y)
        };
    }

    override toRectangle(): RectangleHitbox {
        return this;
    }

    override isPointInside(point: Vector): boolean {
        return point.x > this.min.x && point.y > this.min.y && point.x < this.max.x && point.y < this.max.y;
    }

    override getCenter(): Vector {
        return {
            x: this.min.x + ((this.max.x - this.min.x) / 2),
            y: this.min.y + ((this.max.y - this.min.y) / 2)
        };
    }
}

export class HitboxGroup extends BaseHitbox<HitboxType.Group> {
    override readonly type = HitboxType.Group;
    position = v(0, 0);
    hitboxes: Array<RectangleHitbox | CircleHitbox>;

    constructor(...hitboxes: Array<RectangleHitbox | CircleHitbox>) {
        super();
        this.hitboxes = hitboxes;
    }

    toJSON(): HitboxJsonMapping[HitboxType.Group] {
        return {
            type: HitboxType.Group,
            hitboxes: this.hitboxes.map(hitbox => hitbox.toJSON())
        };
    }

    override collidesWith(that: Hitbox): boolean {
        return this.hitboxes.some(hitbox => hitbox.collidesWith(that));
    }

    override resolveCollision(that: Hitbox): void {
        that.resolveCollision(this);
    }

    override distanceTo(that: CircleHitbox | RectangleHitbox): CollisionRecord {
        let distance = Number.MAX_VALUE;
        let record: CollisionRecord;

        for (const hitbox of this.hitboxes) {
            let newRecord: CollisionRecord;

            switch (hitbox.type) {
                case HitboxType.Circle:
                    switch (that.type) {
                        case HitboxType.Circle:
                            newRecord = distanceToCircle(that.position, that.radius, hitbox.position, hitbox.radius);
                            break;
                        case HitboxType.Rect:
                            newRecord = distanceToRectangle(that.min, that.max, hitbox.position, hitbox.radius);
                            break;
                    }
                    break;
                case HitboxType.Rect: {
                    switch (that.type) {
                        case HitboxType.Circle:
                            newRecord = distanceToRectangle(hitbox.min, hitbox.max, that.position, that.radius);
                            break;
                        case HitboxType.Rect:
                            newRecord = rectangleDistanceToRectangle(that.min, that.max, hitbox.min, hitbox.max);
                    }
                }
            }
            if (newRecord!.distance < distance) {
                record = newRecord!;
                distance = newRecord!.distance;
            }
        }

        return record!;
    }

    override clone(): HitboxGroup {
        return new HitboxGroup(...this.hitboxes.map(hitbox => hitbox.clone()));
    }

    override transform(position: Vector, scale?: number | undefined, orientation?: Orientation | undefined): HitboxGroup {
        this.position = position;

        return new HitboxGroup(
            ...this.hitboxes.map(hitbox => hitbox.transform(position, scale, orientation))
        );
    }

    override scale(scale: number): void {
        for (const hitbox of this.hitboxes) hitbox.scale(scale);
    }

    override intersectsLine(a: Vector, b: Vector): IntersectionResponse {
        const intersections: Array<{ readonly point: Vector, readonly normal: Vector }> = [];

        // get the closest intersection point from the start of the line
        for (const hitbox of this.hitboxes) {
            const intersection = hitbox.intersectsLine(a, b);
            if (intersection) intersections.push(intersection);
        }

        return intersections.sort((c, d) => distanceSquared(c.point, a) - distanceSquared(d.point, a))[0] ?? null;
    }

    override randomPoint(): Vector {
        return pickRandomInArray(this.hitboxes).randomPoint();
    }

    override toRectangle(): RectangleHitbox {
        const min = v(Number.MAX_VALUE, Number.MAX_VALUE);
        const max = v(0, 0);
        for (const hitbox of this.hitboxes) {
            const toRect = hitbox.toRectangle();
            min.x = Math.min(min.x, toRect.min.x);
            min.y = Math.min(min.y, toRect.min.y);
            max.x = Math.max(max.x, toRect.max.x);
            max.y = Math.max(max.y, toRect.max.y);
        }

        return new RectangleHitbox(min, max);
    }

    override isPointInside(point: Vector): boolean {
        for (const hitbox of this.hitboxes) {
            if (hitbox.isPointInside(point)) return true;
        }
        return false;
    }

    override getCenter(): Vector {
        return this.toRectangle().getCenter();
    }
}

export class PolygonHitbox extends BaseHitbox {
    override readonly type = HitboxType.Polygon;
    points: Vector[];

    constructor(points: Vector[]) {
        super();
        this.points = points;
    }

    override toJSON(): HitboxJsonMapping[HitboxType.Polygon] {
        return {
            type: this.type,
            points: this.points.map(point => vClone(point))
        };
    }

    override collidesWith(that: Hitbox): boolean {
        switch (that.type) {
            case HitboxType.Rect:
                if (this.isPointInside(that.min) || this.isPointInside(that.max)) return true;
                for (let i = 0; i < this.points.length; i++) {
                    const a = this.points[i];
                    if (that.isPointInside(a)) return true;
                    const b = i === this.points.length - 1 ? this.points[0] : this.points[i + 1];
                    if (lineIntersectsRect2(b, a, that.min, that.max)) {
                        return true;
                    }
                }
                return false;
        }
        this.throwUnknownSubclassError(that);
    }

    override resolveCollision(that: Hitbox): void {
        this.throwUnknownSubclassError(that);
    }

    override distanceTo(that: CircleHitbox | RectangleHitbox): CollisionRecord {
        this.throwUnknownSubclassError(that);
    }

    override clone(): PolygonHitbox {
        return new PolygonHitbox(this.points);
    }

    override transform(position: Vector, scale: number = 1, orientation: Orientation = 0): PolygonHitbox {
        return new PolygonHitbox(
            this.points.map(point => vMul(addAdjust(position, point, orientation), scale))
        );
    }

    override scale(scale: number): void {
        for (let i = 0, length = this.points.length; i < length; i++) {
            this.points[i] = vMul(this.points[i], scale);
        }
    }

    override intersectsLine(_a: Vector, _b: Vector): IntersectionResponse {
        throw new Error("Operation not supported");
    }

    override randomPoint(): Vector {
        const rect = this.toRectangle();
        let point: Vector;

        do {
            point = rect.randomPoint();
        } while (!this.isPointInside(point));

        return point;
    }

    override toRectangle(): RectangleHitbox {
        const min = v(Number.MAX_VALUE, Number.MAX_VALUE);
        const max = v(0, 0);
        for (const point of this.points) {
            min.x = Math.min(min.x, point.x);
            min.y = Math.min(min.y, point.y);
            max.x = Math.max(max.x, point.x);
            max.y = Math.max(max.y, point.y);
        }

        return new RectangleHitbox(min, max);
    }

    override isPointInside(point: Vector): boolean {
        const { x, y } = point;
        let inside = false;
        const count = this.points.length;
        // take first and last
        // then take second and second last
        // so on
        for (let i = 0, j = count - 1; i < count; j = i++) {
            const { x: xi, y: yi } = this.points[i];
            const { x: xj, y: yj } = this.points[j];

            if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
                inside = !inside;
            }
        }

        return inside;
    }

    override getCenter(): Vector {
        return this.toRectangle().getCenter();
    }
}
