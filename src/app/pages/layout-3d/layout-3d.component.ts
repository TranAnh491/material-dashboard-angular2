import { Component, AfterViewInit, ElementRef, ViewChild, OnDestroy } from '@angular/core';
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry';

@Component({
  selector: 'app-layout-3d',
  templateUrl: './layout-3d.component.html',
  styleUrls: ['./layout-3d.component.scss']
})
export class Layout3dComponent implements AfterViewInit, OnDestroy {
  @ViewChild('rendererContainer') rendererContainer: ElementRef;

  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private frameId: number | null = null;

  constructor() { }

  ngAfterViewInit(): void {
    // We need to wait for the view to be initialized to get the container's dimensions
    // Using a timeout to ensure the DOM has been rendered and dimensions are available
    setTimeout(() => this.init3D(), 0);
  }

  ngOnDestroy(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
    }
    if (this.renderer) {
      this.renderer.dispose();
    }
    // Clean up other Three.js objects like geometries, materials, textures
    if (this.scene) {
        this.scene.traverse(object => {
            if (object instanceof THREE.Mesh) {
                if (object.geometry) {
                    object.geometry.dispose();
                }
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(material => material.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            }
        });
    }
  }

  private init3D(): void {
    const container = this.rendererContainer.nativeElement;
    const width = container.clientWidth;
    const height = container.clientHeight;

    if (width === 0 || height === 0) {
      console.error("Container has zero dimensions. Cannot initialize 3D scene.");
      return;
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xeeeeee);

    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    this.camera.position.set(0, 50, 80);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.25;
    this.controls.screenSpacePanning = false;
    this.controls.maxPolarAngle = Math.PI / 2;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(0, 100, 50);
    this.scene.add(directionalLight);

    this.loadSVG();
    this.animate();
  }

  private loadSVG(): void {
    const loader = new SVGLoader();
    loader.load('assets/img/LayoutD.svg', (data) => {
      this.create3DFromSVG(data.paths);
    });
  }

  private create3DFromSVG(paths): void {
    const fontLoader = new FontLoader();
    fontLoader.load('assets/fonts/helvetiker_regular.typeface.json', (font) => {

        const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc, side: THREE.DoubleSide });
        const floorShape = paths.find(p => p.userData.node.dataset.loc === 'Floor');
        if(floorShape) {
            const floorMesh = this.create2DZone(floorShape, floorMaterial, 0);
            const floorEdges = new THREE.EdgesGeometry(floorMesh.geometry);
            const floorLine = new THREE.LineSegments(floorEdges, new THREE.LineBasicMaterial({ color: 0x000000 }));
            floorMesh.add(floorLine);
            this.scene.add(floorMesh);
        }

        const zoneColors = {
            'Admin': 0xd8e4bc, // light green
            'Quality': 0xd8e4bc, // light green
            'NG': 0xf28b82, // red
            'Production staging': 0xaecbfa, // light blue
            'FG Staging': 0xaecbfa, // light blue
            'Material Staging': 0xaecbfa, // light blue
            'Packing': 0xfee29b, // yellow
            'Office': 0xffd1e1, // light pink
            'Receiving': 0xfee29b, // yellow
            'Shipping': 0xfee29b, // yellow
        };

        paths.forEach(path => {
            const loc = path.userData.node.dataset.loc;
            if (!loc || loc === 'Floor') return;

            if (zoneColors[loc]) {
                const material = new THREE.MeshStandardMaterial({ color: zoneColors[loc], side: THREE.DoubleSide });
                const zoneMesh = this.create2DZone(path, material, 0.1);

                const edges = new THREE.EdgesGeometry(zoneMesh.geometry);
                const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000 }));
                zoneMesh.add(line);

                this.scene.add(zoneMesh);
            } else if (loc.match(/^[A-Q]\d{1,2}$/)) { // Shelves like A1, B12, etc.
                this.createShelf(path, font, loc);
            }
        });
    });
  }

  private create2DZone(path, material, depth) {
    const shapes = SVGLoader.createShapes(path);
    const geometry = new THREE.ExtrudeGeometry(shapes[0], {
        depth: depth,
        bevelEnabled: false
    });
    geometry.center();
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    // Position it based on its original SVG position (approximated by geometry center)
    const box = new THREE.Box3().setFromObject(new THREE.Mesh(geometry));
    const center = new THREE.Vector3();
    box.getCenter(center);
    // This is a rough translation. A more accurate way might be needed if SVGs are complex.
    // For now, we assume the geometry center is close enough to the SVG transform center.
    return mesh;
  }

  private createShelf(path, font, loc: string): void {
      const shapes = SVGLoader.createShapes(path);
      if (shapes.length === 0) return;

      const shape = shapes[0];
      const simpleShapeGeometry = new THREE.ShapeGeometry(shape);
      simpleShapeGeometry.computeBoundingBox();
      const shelfBox = simpleShapeGeometry.boundingBox;

      const width = shelfBox.max.x - shelfBox.min.x;
      const depth = shelfBox.max.y - shelfBox.min.y;

      const shelfGroup = new THREE.Group();

      let tierCount;
      const shelfRow = loc.charAt(0);

      if (['A', 'B', 'C', 'D', 'E'].includes(shelfRow)) {
          tierCount = 7;
      } else { // F, G, Q and office shelves
          tierCount = 5;
      }
      
      if (loc === 'A12') {
          tierCount = 5;
      }
      
      const shelfHeight = 10;
      const postRadius = 0.2;
      const tierHeight = shelfHeight / tierCount;
      const shelfSurfaceThickness = 0.1;

      const postMaterial = new THREE.MeshStandardMaterial({ color: 0xffa500 }); // Bright Orange
      const shelfMaterial = new THREE.MeshStandardMaterial({ color: 0x00BFFF }); // Bright Blue

      // Create posts
      const postGeometry = new THREE.CylinderGeometry(postRadius, postRadius, shelfHeight, 8);
      const positions = [
          [0, 0], [width, 0], [0, -depth], [width, -depth]
      ];
      positions.forEach(pos => {
          const post = new THREE.Mesh(postGeometry, postMaterial);
          post.position.set(pos[0], shelfHeight / 2, pos[1]);
          shelfGroup.add(post);
      });

      // Create tiers and labels
      for (let i = 1; i <= tierCount; i++) {
          const yPos = i * tierHeight - (tierHeight / 2);

          // Shelf surface
          const shelfGeometry = new THREE.BoxGeometry(width, shelfSurfaceThickness, depth);
          const shelfMesh = new THREE.Mesh(shelfGeometry, shelfMaterial);
          shelfMesh.position.set(width / 2, yPos, -depth / 2);
          shelfGroup.add(shelfMesh);

          // Tier Label
          const labelText = `${loc}${i}`;
          const textGeometry = new TextGeometry(labelText, {
              font: font,
              size: 1.5
          });
          textGeometry.center();
          const textMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
          const labelMesh = new THREE.Mesh(textGeometry, textMaterial);
          
          labelMesh.position.set(width / 2, yPos + 0.1 + 0.75, 0.5); // Position in front of shelf
          shelfGroup.add(labelMesh);
      }
      
      // Position the entire shelf group based on SVG coords
      // shelfGroup.position.set(shelfBox.min.x, shelfBox.max.y, 0); // --- Tạm thời vô hiệu hóa
      shelfGroup.position.set(0, 10, 0); // --- Ép kệ hàng xuất hiện ở gốc tọa độ để kiểm tra
      shelfGroup.rotation.x = -Math.PI / 2; 
      
      this.scene.add(shelfGroup);
  }


  private animate(): void {
    this.frameId = requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
