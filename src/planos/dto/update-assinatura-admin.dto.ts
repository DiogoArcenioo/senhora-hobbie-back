import { CreateAssinaturaAdminDto } from './create-assinatura-admin.dto';

export class UpdateAssinaturaAdminDto implements Partial<CreateAssinaturaAdminDto> {
  nome?: string;
  descricao?: string | null;
  tipo?: string;
  valor?: string | number;
  moeda?: string;
  periodicidade_cobranca?: string;
  duracao_dias?: string | number | null;
  duracao_meses?: string | number | null;
  ativo?: boolean | string;
}
