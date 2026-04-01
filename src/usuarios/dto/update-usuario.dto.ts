export class UpdateUsuarioDto {
  nome?: string;
  email?: string;
  senha_hash?: string | null;
  ativo?: boolean;
}
