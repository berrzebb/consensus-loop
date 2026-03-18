/**
 * 공유 테스트 헬퍼.
 * console.log/console.error 는 테스트 결과 출력이 목적이므로 허용.
 */

export const stats = { passed: 0, failed: 0 };

export function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    stats.passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    stats.failed++;
  }
}
