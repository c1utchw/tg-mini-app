// ============================================================
// face-shatter.js — управление режимами разлёта и сборки
//
// Первая тряска  → enterScattered()  — всё разлетается по углам
// Вторая тряска  → enterReassembling() — сильные молнии, сборка домой
//
// Наклон в scattered → applyTiltToAll() — все дрейфуют в сторону наклона
// ============================================================

// Текущее состояние: 'assembled' | 'scattered'
// (PHYSICS_MODE может быть 'reassembling' как переходное — здесь не храним)
let FACE_STATE = 'assembled';

function getFaceState() { return FACE_STATE; }

// Вызывается из renderer.js при каждой тряске (Пробел)
function triggerShatterEffect() {
  if (FACE_STATE === 'assembled') {
    // Первая тряска — разлёт
    FACE_STATE = 'scattered';
    setBoltMode('normal');   // молнии в обычном режиме (видны только при большом отлёте)
    enterScattered();

  } else {
    // Вторая тряска — сборка
    FACE_STATE = 'assembled'; // сразу помечаем, чтобы следующий Пробел снова разлетал
    setBoltMode('reassemble'); // яркие молнии притяжения
    enterReassembling(() => {
      // После завершения сборки — возвращаем обычный режим молний
      setBoltMode('normal');
    });
  }
}
