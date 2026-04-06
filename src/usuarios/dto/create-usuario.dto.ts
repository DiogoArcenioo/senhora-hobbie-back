export type CreateEnderecoUsuarioDto = {
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
};

export class CreateUsuarioDto {
  nome!: string;
  email!: string;
  senha_hash?: string | null;
  tipo?: string;
  ativo?: boolean;
  endereco!: CreateEnderecoUsuarioDto;
}
