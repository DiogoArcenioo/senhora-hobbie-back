export class CreateUsuarioDto {
  nome!: string;
  email!: string;
  senha_hash?: string | null;
  tipo?: string;
  ativo?: boolean;
}
