const fs = require('fs');
const p = 'src/app/pages/zalo/zalo.component.html';
let s = fs.readFileSync(p, 'utf8');

const oldBlock = `                  <tr *ngFor="let u of filteredLinks">
                    <td>
                      <div class="cell-main">{{ u.employeeId }}</div>
                      <div class="cell-sub">{{ u.displayName }}</motion>
                    </td>
                    <td>
                      <div class="cell-main">{{ u.zaloUserId }}</div>
                      <div class="cell-sub">{{ u.zaloDisplayName }}</div>
                    </td>
                    <td>{{ u.factory || 'ALL' }}</td>
                    <td>
                      <span class="pill" [class.pill--off]="!u.enabled">{{ u.enabled ? 'ON' : 'OFF' }}</span>
                    </td>
                    <td class="actions">
                      <button type="button" class="btn btn-small" (click)="toggleEnabled(u)">
                        {{ u.enabled ? 'Disable' : 'Enable' }}
                      </button>
                      <button type="button" class="btn btn-small btn-danger" (click)="deleteLink(u)">
                        Delete
                      </button>
                    </td>
                  </tr>
                  <tr *ngIf="filteredLinks.length === 0">
                    <td colspan="5" class="empty">Chưa có dữ liệu</td>
                  </tr>`;

const newBlock = `                  <tr *ngFor="let u of filteredLinks">
                    <td>
                      <div class="cell-main">{{ u.employeeId }}</div>
                      <div class="cell-sub" *ngIf="u.department">{{ u.department }}</div>
                    </td>
                    <td>
                      <motion class="cell-main">{{ u.displayName || u.zaloDisplayName || '—' }}</div>
                      <div class="cell-sub" *ngIf="u.phone">{{ u.phone }}</div>
                    </td>
                    <td>
                      <div class="cell-main mono">{{ u.chatId || u.zaloUserId }}</div>
                      <div class="cell-sub" *ngIf="u.factory && u.factory !== 'ALL'">{{ u.factory }}</div>
                    </td>
                    <td>
                      <span class="pill pill--source" [class.pill--webhook]="u.linkSource === 'webhook'">
                        {{ u.linkSource === 'webhook' ? 'Bot' : 'Thủ công' }}
                      </span>
                      <div class="cell-sub" *ngIf="u.source">{{ u.source }}</div>
                    </td>
                    <td>
                      <div class="cell-main">{{ formatLinkTime(u.updatedAt) }}</div>
                      <div class="cell-sub" *ngIf="u.createdAt && u.createdAt !== u.updatedAt">
                        Tạo: {{ formatLinkTime(u.createdAt) }}
                      </div>
                    </td>
                    <td>
                      <span class="pill" *ngIf="u.linkSource !== 'webhook'" [class.pill--off]="!u.enabled">
                        {{ u.enabled ? 'Bật' : 'Tắt' }}
                      </span>
                      <span class="pill pill--bot" *ngIf="u.linkSource === 'webhook'">Đã link bot</span>
                    </td>
                    <td class="actions">
                      <button
                        type="button"
                        class="btn btn-small"
                        *ngIf="u.linkSource !== 'webhook'"
                        (click)="toggleEnabled(u)">
                        {{ u.enabled ? 'Tắt' : 'Bật' }}
                      </button>
                      <button type="button" class="btn btn-small btn-danger" (click)="deleteLink(u)">
                        Xóa
                      </button>
                    </td>
                  </tr>
                  <tr *ngIf="filteredLinks.length === 0">
                    <td colspan="7" class="empty">Chưa có ID nào liên kết Zalo trên Firestore</td>
                  </tr>`;

function fixMotion(t) {
  return t.replace(/<\/?motion\b/g, (m) => m.replace('motion', 'div'));
}

const oldClean = fixMotion(oldBlock);
const newClean = fixMotion(newBlock);

if (!s.includes(oldClean)) {
  console.error('OLD block not found');
  process.exit(1);
}

s = s.replace(oldClean, newClean);
fs.writeFileSync(p, s);
console.log('patched ok');
