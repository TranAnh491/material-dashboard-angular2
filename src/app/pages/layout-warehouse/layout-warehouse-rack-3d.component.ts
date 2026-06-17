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
import {
  LayoutQualityRackCell,
  QUALITY_RACK_LEVEL_COUNT,
  buildQualityRackLevelLabel,
  parseLayoutQualityRackCell
} from './layout-warehouse-location.util';

export interface QualityRackSlotOccupancy {
  level: number;
  location: string;
  materialCode: string;
  poNumber: string;
  imd: Date | null;
  stock: number;
}

export interface QualityRackSlotPick {
  level: number;
  location: string;
  items: QualityRackSlotOccupancy[];
}

@Component({
  selector: 'app-layout-warehouse-rack-3d',
  templateUrl: './layout-warehouse-rack-3d.component.html',
  styleUrls: ['./layout-warehouse-rack-3d.component.scss']
})
export class LayoutWarehouseRack3dComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() rackCell = '';
  @Input() occupancy: QualityRackSlotOccupancy[] = [];
  @Input() selectedLevel: number | null = null;
  @Input() selectedSlot: number | null = null;

  @Output() slotPick = new EventEmitter<QualityRackSlotPick>();

  @ViewChild('canvasHost') canvasHost?: ElementRef<HTMLDivElement>;

  readonly levelCount = QUALITY_RACK_LEVEL_COUNT;
  readonly slotCount = 0;

  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private controls?: OrbitControls;
  private frameId = 0;
  private resizeObserver?: ResizeObserver;
  private levelMeshes = new Map<number, THREE.Mesh>();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private rackGroup?: THREE.Group;
  private parsedCell: LayoutQualityRackCell | null = null;

  ngAfterViewInit(): void {
    this.initScene();
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    if (this.canvasHost?.nativeElement) {
      this.resizeObserver.observe(this.canvasHost.nativeElement);
    }
    this.buildRack();
    this.animate();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.scene) return;
    if (changes['rackCell'] || changes['occupancy']) {
      this.buildRack();
    }
    if (changes['selectedLevel'] || changes['selectedSlot'] || changes['occupancy']) {
      this.updateSlotColors();
    }
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.levelMeshes.forEach(mesh => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
    this.levelMeshes.clear();
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
    if (!this.camera || !this.canvasHost?.nativeElement || !this.parsedCell) return;

    const rect = this.canvasHost.nativeElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      Array.from(this.levelMeshes.values()),
      false
    );
    if (!hits.length) return;

    const mesh = hits[0].object as THREE.Mesh;
    const level = Number(mesh.userData['level']);
    const location = String(mesh.userData['location'] || '');
    const items = this.occupancy.filter(o => o.level === level);
    this.slotPick.emit({ level, location, items });
  }

  levelLabel(level: number): string {
    if (!this.parsedCell) return `Tầng ${level}`;
    return buildQualityRackLevelLabel(this.parsedCell, level);
  }

  private initScene(): void {
    const host = this.canvasHost?.nativeElement;
    if (!host) return;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf1f5f9);

    const w = host.clientWidth || 800;
    const h = host.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 200);
    this.camera.position.set(8, 7, 11);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 2.5, 0);
    this.controls.update();

    const ambient = new THREE.AmbientLight(0xffffff, 0.65);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(6, 12, 8);
    key.castShadow = true;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x93c5fd, 0.35);
    fill.position.set(-8, 4, -4);
    this.scene.add(fill);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  private buildRack(): void {
    if (!this.scene) return;

    this.parsedCell = parseLayoutQualityRackCell(this.rackCell);
    if (this.rackGroup) {
      this.scene.remove(this.rackGroup);
      this.rackGroup.traverse(obj => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach(m => m.dispose());
          else mat?.dispose();
        }
      });
    }
    this.levelMeshes.clear();

    if (!this.parsedCell) return;

    const group = new THREE.Group();
    this.rackGroup = group;

    // 3D theo rule mới: chỉ vẽ theo tầng (không chia ô).
    const levelW = 4.8;
    const levelH = 0.42;
    const levelD = 1.05;
    const gapY = 0.18;
    const totalH = QUALITY_RACK_LEVEL_COUNT * (levelH + gapY) - gapY;

    this.addPost(group, -levelW / 2 - 0.12, totalH);
    this.addPost(group, levelW / 2 + 0.12, totalH);

    for (let level = 1; level <= QUALITY_RACK_LEVEL_COUNT; level++) {
      const y = (level - 1) * (levelH + gapY) + levelH / 2;
      const location = buildQualityRackLevelLabel(this.parsedCell, level);
      const occupiedCount = this.occupancy.filter(o => o.level === level).length;
      const occupied = occupiedCount > 0;

      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(levelW, levelH, levelD),
        new THREE.MeshStandardMaterial({
          color: occupied ? 0x3b82f6 : 0xe2e8f0,
          metalness: 0.04,
          roughness: 0.86
        })
      );
      mesh.position.set(0, y, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { level, location };
      group.add(mesh);
      this.levelMeshes.set(level, mesh);

      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.6 })
      );
      edge.position.copy(mesh.position);
      group.add(edge);
    }

    const back = new THREE.Mesh(
      new THREE.BoxGeometry(levelW + 0.18, totalH + 0.26, 0.05),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.1, roughness: 0.9 })
    );
    back.position.set(0, totalH / 2 - 0.02, -(levelD / 2 + 0.06));
    group.add(back);

    this.scene.add(group);
    this.updateSlotColors();
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
    this.levelMeshes.forEach((mesh, level) => {
      const occupied = this.occupancy.some(o => o.level === level);
      const selected = this.selectedLevel === level;
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
