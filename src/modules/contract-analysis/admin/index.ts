/**
 * 계약서 분석 관리(admin) 모듈 진입점
 *
 * 룰셋/표준계약서 데이터 적재 파이프라인(`ContractAdminService`)과 관련
 * 포트/타입을 일괄 re-export 한다.
 */

export {
  ContractAdminService,
  DefaultSnsNotifier,
} from './admin-service.js';

export type {
  SnsNotifier,
  PatternEmbedder,
  ContractVectorIndexPort,
  ContractMetadataPort,
  ContractAdminServiceConfig,
  ContractDataKind,
  LoadableItem,
  FailedPattern,
  AdminLoadResult,
  AdminLoadStatus,
} from './admin-service.js';
