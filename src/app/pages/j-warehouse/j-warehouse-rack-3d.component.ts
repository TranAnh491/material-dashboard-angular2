import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { JwKhoMatRow, JwRack } from './j-warehouse.component';

export interface JwRack3dSlot {
  level: number;
  pos: string;
  occupied: boolean;
}

export interface JwRoller3d {
  edge: 'A' | 'B' | 'D';
  xM?: number;
  yM?: number;
  spanM: number;
  label?: string;
}

export interface JwRect3d {
  id?: string;
  label?: string;
  xM: number;
  yM: number;
  wM: number;
  hM: number;
}

export interface JwRack3dPick {
  level: number;
  pos: string;
  /** Chỉ có ở chế độ 'warehouse' — mã block chứa ô vừa bấm. */
  blockCode?: string;
}

/**
 * Mô hình 3D kệ kho.
 * - mode='block': 1 block (4 tầng × A/B/C) — dùng cho xem/gán pallet chi tiết.
 * - mode='warehouse': toàn bộ kho — kệ trống (beam cam + mâm xanh), vách phòng, nền cao.
 */
@Component({
  selector: 'app-j-warehouse-rack-3d',
  templateUrl: './j-warehouse-rack-3d.component.html',
  styleUrls: ['./j-warehouse-rack-3d.component.scss']
})
export class JWarehouseRack3dComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() mode: 'block' | 'warehouse' = 'block';
  @Input() blockCode = '';
  @Input() occupancy: JwRack3dSlot[] = [];
  @Input() selectedLevel: number | null = null;
  @Input() selectedPos: string | null = null;
  @Input() selectedBlockCode: string | null = null;

  /** Chỉ dùng ở mode='warehouse'. */
  @Input() warehouseRacks: JwRack[] = [];
  @Input() khoMatRows: JwKhoMatRow[] = [];
  @Input() rooms: JwRect3d[] = [];
  @Input() raisedZone: JwRect3d | null = null;
  @Input() raisedHeightM = 0.9;
  @Input() stairSteps: JwRect3d[] = [];
  @Input() rollerDoors: JwRoller3d[] = [];
  @Input() slotPallets: Map<string, string> = new Map();
  @Input() floorLengthM = 105;
  @Input() floorWidthM = 30;
  @Input() rackHeightM = 5;
  @Input() khoMatHeightM = 3;
  @Input() khoMatLevels = 7;

  @Output() slotPick = new EventEmitter<JwRack3dPick>();

  @ViewChild('canvasHost') canvasHost?: ElementRef<HTMLDivElement>;

  readonly levels = [1, 2, 3, 4];
  readonly positions = ['A', 'B', 'C'];

  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private controls?: OrbitControls;
  private frameId = 0;
  private resizeObserver?: ResizeObserver;
  private slotMeshes = new Map<string, THREE.Mesh>();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private rackGroup?: THREE.Group;
  private envGroup?: THREE.Group;

  private readonly boxW = 1.4;
  private readonly boxH = 0.42;
  private readonly boxD = 1.0;
  private readonly gapX = 0.16;
  private readonly gapY = 0.2;

  ngAfterViewInit(): void {
    this.initScene();
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    if (this.canvasHost?.nativeElement) {
      this.resizeObserver.observe(this.canvasHost.nativeElement);
    }
    this.rebuild();
    this.animate();
    requestAnimationFrame(() => this.onResize());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.scene) return;
    if (
      changes['mode'] ||
      changes['blockCode'] ||
      changes['occupancy'] ||
      changes['warehouseRacks'] ||
      changes['floorLengthM'] ||
      changes['floorWidthM'] ||
      changes['rackHeightM']
    ) {
      this.rebuild();
      return;
    }
    if (
      changes['selectedLevel'] ||
      changes['selectedPos'] ||
      changes['selectedBlockCode'] ||
      changes['slotPallets']
    ) {
      this.updateSlotColors();
    }
  }

  private rebuild(): void {
    if (this.mode === 'warehouse') {
      this.buildWarehouse();
    } else {
      this.buildRack();
    }
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.disposeEnvGroup();
    this.disposeRackGroup();
    this.renderer?.dispose();
    if (this.canvasHost?.nativeElement && this.renderer?.domElement.parentElement) {
      this.renderer.domElement.remove();
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.onResize();
  }

  onCanvasClick(event: MouseEvent): void {
    if (!this.camera || !this.canvasHost?.nativeElement) return;

    const rect = this.canvasHost.nativeElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(Array.from(this.slotMeshes.values()), false);
    if (!hits.length) return;

    const mesh = hits[0].object as THREE.Mesh;
    const level = Number(mesh.userData['level'] || 1);
    const pos = String(mesh.userData['pos'] || 'A');
    const blockCode = mesh.userData['blockCode'] as string | undefined;
    this.slotPick.emit(blockCode ? { level, pos, blockCode } : { level, pos });
  }

  private isOccupied(level: number, pos: string): boolean {
    return this.occupancy.some((o) => o.level === level && o.pos === pos && o.occupied);
  }

  private initScene(): void {
    const host = this.canvasHost?.nativeElement;
    if (!host) return;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf1f5f9);

    const w = host.clientWidth || 800;
    const h = host.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 400);
    this.camera.position.set(6, 5, 8);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = this.mode !== 'warehouse';
    host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 1.8, 0);
    this.controls.maxPolarAngle = Math.PI / 2.02;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 280;
    this.controls.update();

    const ambient = new THREE.AmbientLight(0xffffff, 0.72);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 0.78);
    key.position.set(8, 18, 10);
    key.castShadow = this.mode !== 'warehouse';
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x93c5fd, 0.32);
    fill.position.set(-10, 8, -6);
    this.scene.add(fill);
  }

  private disposeGroup(group?: THREE.Group): void {
    if (!this.scene || !group) return;
    this.scene.remove(group);
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const sprite = obj as THREE.Sprite;
      if (sprite.isSprite) {
        const mat = sprite.material as THREE.SpriteMaterial;
        mat.map?.dispose();
        mats.add(mat);
        return;
      }
      if (mesh.isMesh || (obj as THREE.LineSegments).isLineSegments) {
        if (mesh.geometry) geos.add(mesh.geometry);
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => mats.add(m));
        else if (mat) mats.add(mat as THREE.Material);
      }
    });
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => {
      const mapped = m as THREE.MeshLambertMaterial;
      mapped.map?.dispose();
      m.dispose();
    });
  }

  private disposeRackGroup(): void {
    this.disposeGroup(this.rackGroup);
    this.rackGroup = undefined;
    this.slotMeshes.clear();
  }

  private disposeEnvGroup(): void {
    this.disposeGroup(this.envGroup);
    this.envGroup = undefined;
  }

  private buildRack(): void {
    if (!this.scene) return;
    this.disposeRackGroup();

    const group = new THREE.Group();
    this.rackGroup = group;

    const totalW = this.positions.length * this.boxW + (this.positions.length - 1) * this.gapX;
    const totalH = this.levels.length * (this.boxH + this.gapY) - this.gapY;

    this.addPost(group, -totalW / 2 - 0.12, totalH);
    this.addPost(group, totalW / 2 + 0.12, totalH);

    for (const level of this.levels) {
      const y = (level - 1) * (this.boxH + this.gapY) + this.boxH / 2;

      this.positions.forEach((pos, i) => {
        const x = -totalW / 2 + i * (this.boxW + this.gapX) + this.boxW / 2;
        const occupied = this.isOccupied(level, pos);

        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(this.boxW, this.boxH, this.boxD),
          new THREE.MeshStandardMaterial({
            color: occupied ? 0x3b82f6 : 0xe2e8f0,
            metalness: 0.04,
            roughness: 0.86
          })
        );
        mesh.position.set(x, y, 0);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { level, pos };
        group.add(mesh);
        this.slotMeshes.set(`${level}${pos}`, mesh);

        const edge = new THREE.LineSegments(
          new THREE.EdgesGeometry(mesh.geometry),
          new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.6 })
        );
        edge.position.copy(mesh.position);
        group.add(edge);
      });
    }

    const back = new THREE.Mesh(
      new THREE.BoxGeometry(totalW + 0.18, totalH + 0.26, 0.05),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.1, roughness: 0.9 })
    );
    back.position.set(0, totalH / 2 - 0.02, -(this.boxD / 2 + 0.06));
    group.add(back);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    group.add(floor);

    this.scene.add(group);
    this.resetBlockCamera();
    this.updateSlotColors();
  }

  /**
   * Toàn bộ kho: sàn, nền cao +0.9m, vách phòng, kệ trống (beam cam + mâm xanh).
   */
  private buildWarehouse(): void {
    if (!this.scene) return;
    this.disposeRackGroup();
    this.disposeEnvGroup();

    const L = this.floorLengthM;
    const W = this.floorWidthM;
    const H = this.rackHeightM;
    const raiseH = this.raisedHeightM;

    const env = new THREE.Group();
    this.envGroup = env;

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(L, W),
      new THREE.MeshLambertMaterial({ color: 0xd4d4d4 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(L / 2, 0, W / 2);
    env.add(floor);

    const gridPts: number[] = [];
    for (let x = 0; x <= L + 0.01; x += 6) {
      gridPts.push(x, 0.03, 0, x, 0.03, W);
    }
    for (let z = 0; z <= W + 0.01; z += 6) {
      gridPts.push(0, 0.03, z, L, 0.03, z);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
    env.add(new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0xbdbdbd })));

    const shellMat = new THREE.MeshLambertMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const shellH = H + 1.2;
    const wallA = new THREE.Mesh(new THREE.PlaneGeometry(W, shellH), shellMat);
    wallA.rotation.y = Math.PI / 2;
    wallA.position.set(0, shellH / 2, W / 2);
    env.add(wallA);
    const wallD = new THREE.Mesh(new THREE.PlaneGeometry(W, shellH), shellMat);
    wallD.rotation.y = Math.PI / 2;
    wallD.position.set(L, shellH / 2, W / 2);
    env.add(wallD);
    const wallC = new THREE.Mesh(new THREE.PlaneGeometry(L, shellH), shellMat);
    wallC.position.set(L / 2, shellH / 2, 0);
    env.add(wallC);
    const wallB = new THREE.Mesh(new THREE.PlaneGeometry(L, shellH), shellMat);
    wallB.position.set(L / 2, shellH / 2, W);
    env.add(wallB);

    if (this.raisedZone && this.raisedZone.wM > 0 && this.raisedZone.hM > 0) {
      const rz = this.raisedZone;
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(rz.wM, raiseH, rz.hM),
        new THREE.MeshLambertMaterial({ color: 0xb7c2ce })
      );
      pad.position.set(rz.xM + rz.wM / 2, raiseH / 2, rz.yM + rz.hM / 2);
      env.add(pad);
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.2, rz.wM - 0.04), 0.02, Math.max(0.2, rz.hM - 0.04)),
        new THREE.MeshLambertMaterial({ color: 0xd5dde6 })
      );
      top.position.set(rz.xM + rz.wM / 2, raiseH + 0.01, rz.yM + rz.hM / 2);
      env.add(top);
    }

    const stepN = Math.max(this.stairSteps.length, 1);
    this.stairSteps.forEach((s, i) => {
      const h = raiseH * ((i + 1) / stepN);
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(s.wM, h, s.hM),
        new THREE.MeshLambertMaterial({ color: 0x9aa8b6 })
      );
      step.position.set(s.xM + s.wM / 2, h / 2, s.yM + s.hM / 2);
      env.add(step);
    });

    this.addRoomWalls(env);
    this.addRollerDoors(env);
    this.scene.add(env);

    const group = new THREE.Group();
    this.rackGroup = group;
    const beamMat = new THREE.MeshLambertMaterial({ color: 0xea580c });
    const shelfMat = new THREE.MeshLambertMaterial({ color: 0x2563eb });
    const postMat = new THREE.MeshLambertMaterial({ color: 0xc2410c });

    for (const rack of this.warehouseRacks) {
      for (const block of rack.blocks) {
        this.addEmptyRack(group, block, this.levels.length, H, beamMat, shelfMat, postMat, block.code);
      }
      this.addRackHeadSign(group, rack, H);
    }
    for (const row of this.khoMatRows) {
      for (const block of row.blocks) {
        this.addEmptyRack(
          group,
          block,
          this.khoMatLevels,
          this.khoMatHeightM,
          beamMat,
          shelfMat,
          postMat,
          block.code
        );
      }
    }

    this.scene.add(group);
    this.frameWarehouseCamera(0, L, 0, W);
  }

  /** Kệ trống: trụ + beam cam + mâm xanh, không vẽ hàng. */
  private addEmptyRack(
    group: THREE.Group,
    block: { xM: number; yM: number; wM: number; hM: number },
    levelCount: number,
    heightM: number,
    beamMat: THREE.Material,
    shelfMat: THREE.Material,
    postMat: THREE.Material,
    blockCode?: string
  ): void {
    const pitch = heightM / Math.max(levelCount, 1);
    const beamH = 0.1;
    const beamT = 0.08;
    const shelfT = 0.04;
    const postT = 0.08;
    const bx = block.xM + block.wM / 2;
    const bz = block.yM + block.hM / 2;

    const corners: Array<[number, number]> = [
      [block.xM + postT / 2, block.yM + postT / 2],
      [block.xM + block.wM - postT / 2, block.yM + postT / 2],
      [block.xM + postT / 2, block.yM + block.hM - postT / 2],
      [block.xM + block.wM - postT / 2, block.yM + block.hM - postT / 2]
    ];
    const postGeo = new THREE.BoxGeometry(postT, heightM, postT);
    for (const [px, pz] of corners) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(px, heightM / 2, pz);
      group.add(post);
    }

    const alongX = block.wM >= block.hM;
    for (let li = 0; li < levelCount; li++) {
      const yBeam = li * pitch + beamH / 2;
      if (alongX) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(block.wM, beamH, beamT), beamMat);
        const b0 = beam.clone();
        b0.position.set(bx, yBeam, block.yM + beamT / 2);
        const b1 = beam.clone();
        b1.position.set(bx, yBeam, block.yM + block.hM - beamT / 2);
        group.add(b0, b1);
      } else {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(beamT, beamH, block.hM), beamMat);
        const b0 = beam.clone();
        b0.position.set(block.xM + beamT / 2, yBeam, bz);
        const b1 = beam.clone();
        b1.position.set(block.xM + block.wM - beamT / 2, yBeam, bz);
        group.add(b0, b1);
      }

      const shelf = new THREE.Mesh(
        new THREE.BoxGeometry(
          Math.max(0.12, block.wM - beamT * 2),
          shelfT,
          Math.max(0.12, block.hM - beamT * 2)
        ),
        shelfMat
      );
      shelf.position.set(bx, yBeam + beamH / 2 + shelfT / 2, bz);
      if (blockCode) {
        shelf.userData = { blockCode, level: li + 1, pos: 'A' };
        this.slotMeshes.set(`${blockCode}-L${li + 1}`, shelf);
      }
      group.add(shelf);
    }
  }

  /** Bảng trắng tầng cao nhất — phía mặt B, ghi R1…Rn (1 bảng / dãy). */
  private addRackHeadSign(group: THREE.Group, rack: JwRack, heightM: number): void {
    if (!rack.blocks.length) return;
    const minX = Math.min(...rack.blocks.map((b) => b.xM));
    const maxX = Math.max(...rack.blocks.map((b) => b.xM + b.wM));
    const maxZ = Math.max(...rack.blocks.map((b) => b.yM + b.hM));
    const label = `R${rack.num}`;
    const boardW = 0.78;
    const boardH = 0.36;
    const boardT = 0.03;
    const y = heightM - boardH / 2 - 0.04;
    const tex = this.makeRackSignTexture(label);
    const mat = new THREE.MeshLambertMaterial({ map: tex, color: 0xffffff });
    const board = new THREE.Mesh(new THREE.BoxGeometry(boardW, boardH, boardT), mat);
    board.position.set((minX + maxX) / 2, y, maxZ + boardT / 2 + 0.01);
    group.add(board);
  }

  private makeRackSignTexture(text: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 256, 128);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, 248, 120);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 72px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 128, 68);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  /** Cửa cuốn mặt A / B / D — khung vàng, nan xám, vạch ngưỡng. */
  private addRollerDoors(env: THREE.Group): void {
    const doorH = 3.4;
    const thick = 0.16;
    const frameT = 0.12;
    const frameMat = new THREE.MeshLambertMaterial({ color: 0xf59e0b });
    const slatMat = new THREE.MeshLambertMaterial({ color: 0x64748b });
    const slatAlt = new THREE.MeshLambertMaterial({ color: 0x475569 });
    const threshMat = new THREE.MeshLambertMaterial({ color: 0xfbbf24 });
    const L = this.floorLengthM;
    const W = this.floorWidthM;

    for (const door of this.rollerDoors) {
      if (door.edge === 'B') {
        const span = Math.max(door.spanM, 0.8);
        const x = (door.xM || 0) + span / 2;
        const z = W - thick / 2;

        const shutter = new THREE.Mesh(
          new THREE.BoxGeometry(span - 0.16, doorH - 0.2, thick * 0.7),
          slatMat
        );
        shutter.position.set(x, (doorH - 0.2) / 2, z);
        env.add(shutter);

        const ribN = 10;
        for (let i = 1; i < ribN; i++) {
          const rib = new THREE.Mesh(
            new THREE.BoxGeometry(span - 0.2, 0.05, thick * 0.85),
            i % 2 ? slatAlt : slatMat
          );
          rib.position.set(x, (doorH * i) / ribN, z);
          env.add(rib);
        }

        const post0 = new THREE.Mesh(new THREE.BoxGeometry(frameT, doorH, frameT), frameMat);
        const post1 = new THREE.Mesh(new THREE.BoxGeometry(frameT, doorH, frameT), frameMat);
        post0.position.set(x - span / 2, doorH / 2, z);
        post1.position.set(x + span / 2, doorH / 2, z);
        env.add(post0, post1);
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(span, frameT, frameT), frameMat);
        lintel.position.set(x, doorH, z);
        env.add(lintel);

        const thresh = new THREE.Mesh(new THREE.BoxGeometry(span, 0.04, 0.9), threshMat);
        thresh.position.set(x, 0.04, W - 0.5);
        env.add(thresh);

        const sprite = this.makeLabelSprite(door.label || 'Cửa cuốn');
        sprite.position.set(x, doorH + 0.45, W - 1.2);
        sprite.scale.set(3.6, 0.85, 1);
        env.add(sprite);
        continue;
      }

      if (door.edge !== 'A' && door.edge !== 'D') continue;
      const span = Math.max(door.spanM, 0.8);
      const z = (door.yM || 0) + span / 2;
      const isA = door.edge === 'A';
      const x = isA ? thick / 2 : L - thick / 2;

      const shutter = new THREE.Mesh(new THREE.BoxGeometry(thick * 0.7, doorH - 0.2, span - 0.16), slatMat);
      shutter.position.set(x, (doorH - 0.2) / 2, z);
      env.add(shutter);

      const ribN = 10;
      for (let i = 1; i < ribN; i++) {
        const rib = new THREE.Mesh(
          new THREE.BoxGeometry(thick * 0.85, 0.05, span - 0.2),
          i % 2 ? slatAlt : slatMat
        );
        rib.position.set(x, (doorH * i) / ribN, z);
        env.add(rib);
      }

      const postH = doorH;
      const post0 = new THREE.Mesh(new THREE.BoxGeometry(frameT, postH, frameT), frameMat);
      const post1 = new THREE.Mesh(new THREE.BoxGeometry(frameT, postH, frameT), frameMat);
      post0.position.set(x, postH / 2, z - span / 2);
      post1.position.set(x, postH / 2, z + span / 2);
      env.add(post0, post1);
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(frameT, frameT, span), frameMat);
      lintel.position.set(x, doorH, z);
      env.add(lintel);

      const thresh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, span), threshMat);
      thresh.position.set(isA ? 0.5 : L - 0.5, 0.04, z);
      env.add(thresh);

      const sprite = this.makeLabelSprite(door.label || 'Cửa cuốn');
      sprite.position.set(isA ? 1.2 : L - 1.2, doorH + 0.45, z);
      sprite.scale.set(3.6, 0.85, 1);
      env.add(sprite);
    }
  }

  private addRoomWalls(env: THREE.Group): void {
    const wallH = 3;
    const wallT = 0.08;
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xc5e4f7,
      metalness: 0.05,
      roughness: 0.06,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const whiteWallMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide
    });
    const solidMat = new THREE.MeshLambertMaterial({
      color: 0xe8eef5,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide
    });
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x94a3b8 });
    const whiteFloorMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.28,
      metalness: 0.02,
      emissive: 0xffffff,
      emissiveIntensity: 0.14
    });
    const skipKeys = this.officeSharedWallKeys();
    const seen = new Set<string>();
    for (const room of this.rooms) {
      if (!(room.wM > 0.2 && room.hM > 0.2)) continue;
      const x0 = room.xM;
      const z0 = room.yM;
      const x1 = room.xM + room.wM;
      const z1 = room.yM + room.hM;
      const style = this.roomWallStyle(room.id);

      if (this.isWhiteFloorRoom(room.id)) {
        const slab = new THREE.Mesh(
          new THREE.PlaneGeometry(room.wM, room.hM),
          whiteFloorMat
        );
        slab.rotation.x = -Math.PI / 2;
        slab.position.set((x0 + x1) / 2, 0.04, (z0 + z1) / 2);
        env.add(slab);
      }

      this.addStyledWall(env, seen, skipKeys, x0, z0, x1, z0, wallT, wallH, style, glassMat, whiteWallMat, solidMat, frameMat);
      this.addStyledWall(env, seen, skipKeys, x0, z1, x1, z1, wallT, wallH, style, glassMat, whiteWallMat, solidMat, frameMat);
      this.addStyledWall(env, seen, skipKeys, x0, z0, x0, z1, wallT, wallH, style, glassMat, whiteWallMat, solidMat, frameMat);
      this.addStyledWall(env, seen, skipKeys, x1, z0, x1, z1, wallT, wallH, style, glassMat, whiteWallMat, solidMat, frameMat);

      if (room.label) {
        const sprite = this.makeLabelSprite(room.label);
        const labelZ =
          room.id === 'secured' ? (z0 + z1) / 2 - 1.5 : (z0 + z1) / 2;
        sprite.position.set((x0 + x1) / 2, 1.55, labelZ);
        env.add(sprite);
      }
    }
  }

  private roomWallStyle(id?: string): 'glass' | 'half' | 'solid' {
    const s = id || '';
    if (s.startsWith('vp-kho')) return 'glass';
    if (s === 'iqc' || s === 'secured' || s === 'kho-mat-ext') return 'half';
    return 'solid';
  }

  private isWhiteFloorRoom(id?: string): boolean {
    const s = id || '';
    return s === 'iqc' || s === 'secured' || s === 'kho-mat-ext' || s.startsWith('vp-kho');
  }

  /** Bỏ vách chung giữa 2 phòng Office (VP Kho). */
  private officeSharedWallKeys(): Set<string> {
    const keys = new Set<string>();
    const offices = this.rooms.filter((r) => (r.id || '').startsWith('vp-kho'));
    for (let i = 0; i < offices.length; i++) {
      for (let j = i + 1; j < offices.length; j++) {
        const shared = this.sharedRectEdgeKey(offices[i], offices[j]);
        if (shared) keys.add(shared);
      }
    }
    return keys;
  }

  private sharedRectEdgeKey(a: JwRect3d, b: JwRect3d): string | null {
    const ax0 = a.xM;
    const ax1 = a.xM + a.wM;
    const az0 = a.yM;
    const az1 = a.yM + a.hM;
    const bx0 = b.xM;
    const bx1 = b.xM + b.wM;
    const bz0 = b.yM;
    const bz1 = b.yM + b.hM;
    const near = (p: number, q: number) => Math.abs(p - q) < 0.08;

    if (near(ax1, bx0) || near(ax0, bx1)) {
      const x = near(ax1, bx0) ? ax1 : ax0;
      const z0 = Math.max(az0, bz0);
      const z1 = Math.min(az1, bz1);
      if (z1 - z0 > 0.2) return this.wallKey(x, z0, x, z1);
    }
    if (near(az1, bz0) || near(az0, bz1)) {
      const z = near(az1, bz0) ? az1 : az0;
      const x0 = Math.max(ax0, bx0);
      const x1 = Math.min(ax1, bx1);
      if (x1 - x0 > 0.2) return this.wallKey(x0, z, x1, z);
    }
    return null;
  }

  private addStyledWall(
    env: THREE.Group,
    seen: Set<string>,
    skipKeys: Set<string>,
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    wallT: number,
    wallH: number,
    style: 'glass' | 'half' | 'solid',
    glassMat: THREE.Material,
    whiteWallMat: THREE.Material,
    solidMat: THREE.Material,
    frameMat: THREE.Material
  ): void {
    const key = this.wallKey(x1, z1, x2, z2);
    if (seen.has(key) || skipKeys.has(key)) return;
    seen.add(key);
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.08) return;
    const cx = (x1 + x2) / 2;
    const cz = (z1 + z2) / 2;
    const rotY = Math.atan2(dx, dz);
    const addBox = (h: number, y: number, mat: THREE.Material, t = wallT) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(t, h, len), mat);
      wall.position.set(cx, y, cz);
      wall.rotation.y = rotY;
      env.add(wall);
    };
    if (style === 'glass') {
      addBox(wallH, wallH / 2, glassMat);
      addBox(0.04, 0.02, frameMat, wallT + 0.02);
      addBox(0.04, wallH, frameMat, wallT + 0.02);
    } else if (style === 'half') {
      const half = wallH / 2;
      addBox(half, half / 2, whiteWallMat, wallT + 0.04);
      addBox(half, half + half / 2, glassMat);
      addBox(0.05, half, frameMat, wallT + 0.04);
      addBox(0.04, wallH, frameMat, wallT + 0.02);
    } else {
      addBox(wallH, wallH / 2, solidMat, wallT + 0.04);
    }
  }

  private wallKey(x1: number, z1: number, x2: number, z2: number): string {
    const r = (n: number) => Math.round(n * 20) / 20;
    const a = `${r(x1)},${r(z1)}`;
    const b = `${r(x2)},${r(z2)}`;
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  private makeLabelSprite(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const spriteMat = new THREE.SpriteMaterial({ transparent: true, depthTest: true });
    if (ctx) {
      ctx.clearRect(0, 0, 512, 128);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.beginPath();
      const rad = 18;
      ctx.moveTo(rad, 8);
      ctx.arcTo(504, 8, 504, 120, rad);
      ctx.arcTo(504, 120, 8, 120, rad);
      ctx.arcTo(8, 120, 8, 8, rad);
      ctx.arcTo(8, 8, 504, 8, rad);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 42px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 68);
      spriteMat.map = new THREE.CanvasTexture(canvas);
    }
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(Math.min(6.5, 0.38 * Math.max(text.length, 4)), 1.15, 1);
    return sprite;
  }

  /** Camera nhìn hết sàn kho, hơi cao để thấy rõ 4 tầng. */
  private frameWarehouseCamera(minX: number, maxX: number, minZ: number, maxZ: number): void {
    if (!this.camera || !this.controls) return;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const spanX = Math.max(maxX - minX, 10);
    const spanZ = Math.max(maxZ - minZ, 10);
    const span = Math.max(spanX, spanZ);

    this.camera.near = 0.2;
    this.camera.far = span * 6 + 120;
    this.camera.updateProjectionMatrix();

    this.camera.position.set(cx - spanX * 0.12, this.rackHeightM * 4.2 + span * 0.22, cz + spanZ * 1.15);
    this.controls.target.set(cx, this.rackHeightM * 0.45, cz);
    this.controls.minDistance = 8;
    this.controls.maxDistance = span * 2.4;
    this.controls.update();
  }

  /** Đưa camera về vị trí mặc định khi xem 1 block (mode='block'). */
  private resetBlockCamera(): void {
    if (!this.camera || !this.controls) return;
    this.camera.near = 0.1;
    this.camera.far = 200;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(6, 5, 8);
    this.controls.target.set(0, 1.8, 0);
    this.controls.update();
  }

  private addPost(group: THREE.Group, x: number, height: number): void {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, height + 0.24, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.35, roughness: 0.55 })
    );
    post.position.set(x, height / 2 - 0.02, 0);
    post.castShadow = true;
    group.add(post);
  }

  private updateSlotColors(): void {
    if (this.mode === 'warehouse') return;
    this.slotMeshes.forEach((mesh) => {
      const level = Number(mesh.userData['level']);
      const pos = String(mesh.userData['pos'] || '');
      const occupied = this.isOccupied(level, pos);
      const selected = this.selectedLevel === level && this.selectedPos === pos;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (selected) {
        mat.color.setHex(0xf59e0b);
        mat.emissive.setHex(0x92400e);
        mat.emissiveIntensity = 0.25;
      } else if (occupied) {
        mat.color.setHex(0x3b82f6);
        mat.emissive.setHex(0x1e3a8a);
        mat.emissiveIntensity = 0.12;
      } else {
        mat.color.setHex(0xe2e8f0);
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      }
    });
  }

  private onResize(): void {
    const host = this.canvasHost?.nativeElement;
    if (!host || !this.camera || !this.renderer) return;
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private animate = (): void => {
    this.frameId = requestAnimationFrame(this.animate);
    this.controls?.update();
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  };
}
